/* 标准驱动 / 参数不写死 的护栏
 * ────────────────────────────────────────────────
 * 起因：系统里有三份 UFP 权值（页面硬编码一份、server/utils/pricing.ts 硬编码一份、
 *   数据库表里还存着一份，数值恰好相同），于是「在表里改权重完全不生效」却查不出来；
 *   复杂度判定规则更是压根不存在，只能让 AI 拍脑袋填复杂度。
 * 本次改造把领域参数全部搬进 pricing_defaults 表，本脚本负责把「搬对了」和「没回退」锁住。
 *
 * 断言分三类：
 *   一、搬迁保真：种子里的值 == 改造前代码里的常量（逐个值比对，防抄错）
 *   二、算法自洽：复杂度矩阵结构合法、边界抽样判定正确、权值取用正确
 *   三、防回退：源码里不许再出现 UFP 权值 / 兜底值 字面量，前后端必须共用 shared/ufp.ts
 *
 * ⚠️ 本脚本是纯静态的（不连数据库）：它校验的是「种子 + 源码」——
 *    种子就是部署时写进库里的那份，源码就是运行时读它的那份，两头都锁住即可。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pricingDefaults } from '../server/seed/pricingDefaults'
import {
  classifyComplexity, ufpWeightOf, validateComplexityRules, validateUfpMethods,
} from '../shared/ufp'

/** 定位项目文件：打包产物在 node_modules/.cache 下，cwd 不稳定（沙箱里可能是盘根），两条路都试 */
function findFile(rel: string): string | null {
  const cands = [
    resolve(process.cwd(), rel),
    resolve(dirname(fileURLToPath(import.meta.url)), '../..', rel),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../..', rel),
  ]
  return cands.find((p) => existsSync(p)) || null
}
function readSrc(rel: string): string {
  const p = findFile(rel)
  if (!p) throw new Error(`找不到文件 ${rel}`)
  return readFileSync(p, 'utf8')
}

const results: [string, boolean, string][] = []
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const byKey = new Map(pricingDefaults.map((d) => [d.key, d.value as any]))

// ══ 一、搬迁保真：种子 == 改造前代码里的常量 ═══════════════════════════
// 下面的期望值是改造前那两份硬编码常量的原值快照。任何一个数对不上，
// 说明搬家时抄错了 —— 那会让所有历史项目的金额悄悄变化。
const WAS_UFP_WEIGHT = {
  ILF: { 低: 7, 中: 10, 高: 15 },
  EIF: { 低: 5, 中: 7, 高: 10 },
  EI: { 低: 3, 中: 4, 高: 6 },
  EO: { 低: 4, 中: 5, 高: 7 },
  EQ: { 低: 3, 中: 4, 高: 6 },
}
const WAS_PROVINCE_CITY = {
  四川: '成都', 北京: '北京', 山东: '济南', 江西: '南昌',
  河南: '郑州', 山西: '太原', 河北: '石家庄', 全国: '',
}

const ifpug = byKey.get('ufp_methods')?.methods?.['ifpug-ufp']
results.push(['详细功能点法的 15 项权值与改造前硬编码逐项一致', eq(ifpug?.weights, WAS_UFP_WEIGHT),
  eq(ifpug?.weights, WAS_UFP_WEIGHT) ? 'ILF/EIF/EI/EO/EQ × 低中高 全部相同'
    : `不一致：${JSON.stringify(ifpug?.weights)}`])

const hm = byKey.get('fallback_hm')
results.push(['人月折算系数兜底值 = 174（改造前 FALLBACK_HM）', Number(hm?.value) === 174,
  `当前 ${hm?.value}`])

const pdr = byKey.get('fallback_pdr')
results.push(['兜底生产率 开发 6.72 / 运维 1.07（改造前两个常量）',
  Number(pdr?.development?.value) === 6.72 && Number(pdr?.maintenance?.value) === 1.07,
  `当前 开发 ${pdr?.development?.value} / 运维 ${pdr?.maintenance?.value}`])

const pc = byKey.get('province_city')
results.push(['省份→代表城市映射与改造前硬编码一致', eq(pc, WAS_PROVINCE_CITY),
  eq(pc, WAS_PROVINCE_CITY) ? `${Object.keys(WAS_PROVINCE_CITY).length} 个省/全国` : `不一致：${JSON.stringify(pc)}`])

// 迁移来的「快速功能点法 / 全功能点法」必须与参数字典里那份一致（山西标准在用）
const rapid = byKey.get('ufp_methods')?.methods?.['rapid-ufp']
const full = byKey.get('ufp_methods')?.methods?.['full-ufp']
results.push(['快速功能点法 35×ILF + 15×EIF 与参数字典一致',
  rapid?.weights?.ILF === 35 && rapid?.weights?.EIF === 15 && rapid?.complexityBased === false,
  `ILF ${rapid?.weights?.ILF} / EIF ${rapid?.weights?.EIF}`])
results.push(['全功能点法 10/7/4/5/4 与参数字典一致',
  full?.weights?.ILF === 10 && full?.weights?.EIF === 7 && full?.weights?.EI === 4 &&
  full?.weights?.EO === 5 && full?.weights?.EQ === 4 && full?.complexityBased === false,
  `ILF/EIF/EI/EO/EQ = ${full?.weights?.ILF}/${full?.weights?.EIF}/${full?.weights?.EI}/${full?.weights?.EO}/${full?.weights?.EQ}`])

// ══ 二、算法自洽 ════════════════════════════════════════════════════
const lib = byKey.get('ufp_methods')
const methods = lib?.methods
const ruleProblems = validateComplexityRules(byKey.get('complexity_rules'))
results.push(['复杂度判定矩阵结构合法（行列档数 = 矩阵维度、取值仅低/中/高）', ruleProblems.length === 0,
  ruleProblems.length ? ruleProblems.join('；') : '5 类功能点全部结构正确'])

const methodProblems = validateUfpMethods(methods)
results.push(['功能点方法库结构合法（每套方法都有 label / complexityBased / 完整权值）', methodProblems.length === 0,
  methodProblems.length ? methodProblems.join('；') : `${Object.keys(methods || {}).length} 套方法全部正确`])

results.push(['默认方法存在（ufp_methods.default 指向方法库里的键）',
  !!lib?.default && !!methods?.[lib.default], `default = ${lib?.default}`])

// 判定抽样：覆盖 ILF/EIF（RET×DET）与 EI/EO/EQ（FTR×DET），含边界
const rules = byKey.get('complexity_rules')
const cases: [string, number, number, number, string][] = [
  // 类型, RET, DET, FTR, 期望复杂度
  ['ILF', 1, 1, 0, '低'],      // RET 1 / DET 1-19
  ['ILF', 1, 51, 0, '中'],     // RET 1 / DET 51+
  ['ILF', 2, 20, 0, '中'],     // RET 2-5 / DET 20-50
  ['ILF', 6, 51, 0, '高'],     // RET 6+ / DET 51+
  ['EIF', 6, 20, 0, '高'],     // 与 ILF 同矩阵
  ['EI', 0, 1, 0, '低'],       // FTR 0-1 / DET 1-4
  ['EI', 0, 16, 0, '中'],      // FTR 0-1 / DET 16+
  ['EI', 2, 5, 2, '中'],       // FTR 2 / DET 5-15
  ['EI', 3, 16, 3, '高'],      // FTR 3+ / DET 16+
  ['EO', 0, 5, 0, '低'],       // FTR 0-1 / DET 1-5
  ['EO', 0, 20, 0, '中'],      // FTR 0-1 / DET 20+
  ['EO', 4, 20, 4, '高'],      // FTR 4+ / DET 20+
  ['EQ', 0, 6, 0, '低'],       // EQ 的 DET 档与 EO 同行（1-5/6-19/20+）：FTR 0-1 时 6-19 档仍是「低」
  ['EQ', 2, 6, 2, '中'],       // FTR 2-3 / DET 6-19 → 中（EI 在这一带是 5-15，两类阈值不同）
  ['EQ', 4, 20, 4, '高'],      // FTR 4+ / DET 20+
]
const badCases = cases.filter(([t, ret, det, ftr, want]) =>
  classifyComplexity(rules, t, ret, det, ftr) !== want)
results.push(['复杂度判定抽样正确（含 ILF/EIF 用 RET、EI/EO/EQ 用 FTR 的分流与边界）',
  badCases.length === 0,
  badCases.length
    ? badCases.map(([t, ret, det, ftr, want]) => `${t} RET${ret}/DET${det}/FTR${ftr} 期望${want} 实得${classifyComplexity(rules, t, ret, det, ftr)}`).join('；')
    : `${cases.length} 个抽样点全部命中`])

results.push(['未知类型判定返回 null（不悄悄当「中」）',
  classifyComplexity(rules, 'XX', 1, 1, 1) === null, 'XX → null'])

// 权值取用：按复杂度取 / 只按类型取
const wBad: string[] = []
if (ufpWeightOf(ifpug, 'ILF', '中') !== 10) wBad.push(`详细功能点法 ILF中 应为 10，实得 ${ufpWeightOf(ifpug, 'ILF', '中')}`)
if (ufpWeightOf(ifpug, 'EQ', '低') !== 3) wBad.push(`详细功能点法 EQ低 应为 3，实得 ${ufpWeightOf(ifpug, 'EQ', '低')}`)
if (ufpWeightOf(rapid, 'ILF', '高') !== 35) wBad.push(`快速功能点法 ILF 应恒为 35（不分复杂度），实得 ${ufpWeightOf(rapid, 'ILF', '高')}`)
if (ufpWeightOf(rapid, 'EI', '中') !== null) wBad.push('快速功能点法不该有 EI 权值（应返回 null）')
if (ufpWeightOf(full, 'EQ', '低') !== 4) wBad.push(`全功能点法 EQ 应为 4，实得 ${ufpWeightOf(full, 'EQ', '低')}`)
results.push(['权值取用正确（按复杂度 / 只按类型；取不到返回 null 而非 0）', wBad.length === 0,
  wBad.length ? wBad.join('；') : '详细/快速/全功能点法各自的取用方式均正确'])

// ══ 三、防回退：源码里不许再出现这些字面量 ══════════════════════════
// 只在运行时目录里查；server/seed/ 是种子（它本来就是表内容的来源），不在此列。
const RUNTIME_FILES = [
  'pages/projects/[id].vue',
  'pages/projects/index.vue',
  'server/utils/pricing.ts',
  'server/utils/pricingStandards.ts',
  'server/utils/pricingParams.ts',
  'server/api/projects/[id]/analyze.post.ts',
  'server/api/projects/[id]/function-points.put.ts',
  'server/api/projects/[id]/calculate.post.ts',
]
const FORBIDDEN: [RegExp, string][] = [
  [/ILF:\s*\{\s*低:\s*7/, 'IFPUG 权值字面量（ILF 低7…）'],
  [/const\s+UFP_WEIGHT\b/, '局部 UFP_WEIGHT 常量'],
  [/\bcomputeUFP\s*\(/, '旧的 computeUFP（已由表驱动的 ufpWeightOf 取代）'],
  [/\bFALLBACK_HM\b/, '硬编码兜底 HM'],
  [/\bFALLBACK_PDR_(DEV|MAINT)\b/, '硬编码兜底生产率'],
  [/\bPROVINCE_CITY\b/, '硬编码省份→城市映射'],
]
const hits: string[] = []
for (const rel of RUNTIME_FILES) {
  const src = readSrc(rel)
  for (const [re, what] of FORBIDDEN) if (re.test(src)) hits.push(`${rel} → ${what}`)
}
results.push(['运行时源码里没有再把领域参数写成字面量', hits.length === 0,
  hits.length ? hits.join('；') : `${RUNTIME_FILES.length} 个运行时文件已核对干净`])

// 前后端必须共用同一份算法实现（这是「前端预览 ≠ 后端入库」这类坑的根治办法）
const sharedUsedByServer = /from\s+['"][^'"]*shared\/ufp['"]/.test(readSrc('server/utils/pricingParams.ts'))
const sharedUsedByPage = /from\s+['"][^'"]*shared\/ufp['"]/.test(readSrc('pages/projects/[id].vue'))
results.push(['功能点算法前后端共用 shared/ufp.ts（不各写一份）',
  sharedUsedByServer && sharedUsedByPage,
  `服务端 ${sharedUsedByServer ? '✓' : '✗'} / 工作台 ${sharedUsedByPage ? '✓' : '✗'}`])

// 解析层必须走「查表」而不是拿默认值顶着：缺 key 要抛错
const resolverSrc = readSrc('server/utils/pricingParams.ts')
results.push(['取数出口缺配置时抛错（而非静默给默认值）',
  /fail\(/.test(resolverSrc) && /pricing_defaults/.test(resolverSrc) && /validateComplexityRules/.test(resolverSrc),
  '缺 key / JSON 坏 / 矩阵非法一律 fail()'])

// 引擎不再让 AI 定复杂度：提示词里不许再要求 complexity，且必须真的用矩阵判定。
// ⚠️ 这里必须锚定「用 profile.rules 调用 classifyComplexity」这个动作，
//    不能只查函数名是否出现 —— 函数名还留在 import 行里，
//    把调用本身删掉退化成让 AI 填复杂度，只查名字就会漏（反向验证时真踩到过）。
const analyzeSrc = readSrc('server/api/projects/[id]/analyze.post.ts')
const usesMatrix = /classifyComplexity\(\s*profile\.rules\s*,/.test(analyzeSrc)
results.push(['AI 识别接口不再要求 AI 判定复杂度（改由矩阵判定）',
  !/"complexity":/.test(analyzeSrc) && usesMatrix,
  `提示词已移除 complexity：${!/"complexity":/.test(analyzeSrc) ? '✓' : '✗'}；实际按 profile.rules 判定：${usesMatrix ? '✓' : '✗'}`])

// ══ 输出 ══════════════════════════════════════════════════════════
console.log('\n══ 标准驱动 / 参数表化 护栏 ══')
for (const [name, ok, detail] of results) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`)
  console.log(`      ${detail}`)
}
const failed = results.filter((r) => !r[1])
console.log('')
if (failed.length) {
  console.log(`✗ 未通过：${failed.length} 项`)
  process.exit(1)
}
console.log(`✓ 通过：${results.length} 项（搬迁保真 / 算法自洽 / 未回退）`)
console.log('')
