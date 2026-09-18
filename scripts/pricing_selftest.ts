/* 标准驱动 / 参数不写死 的护栏
 * ────────────────────────────────────────────────
 * 起因：系统里有三份 UFP 权值（页面硬编码一份、server/utils/pricing.ts 硬编码一份、
 *   数据库表里还存着一份，数值恰好相同），于是「在表里改权重完全不生效」却查不出来；
 *   复杂度判定规则更是压根不存在，只能让 AI 拍脑袋填复杂度。
 * 本次改造把领域参数全部搬进 pricing_defaults 表，本脚本负责把「搬对了」和「没回退」锁住。
 *
 * 断言分四类：
 *   一、搬迁保真：种子里的值 == 改造前代码里的常量（逐个值比对，防抄错）
 *   二、算法自洽：复杂度矩阵结构合法、边界抽样判定正确、权值取用正确
 *   三、防回退：源码里不许再出现 UFP 权值 / 兜底值 字面量，前后端必须共用 shared/ufp.ts
 *   四、取名即取数：引擎只认参数键（param_key），不再按中文名匹配取值 ——
 *       含「搬迁保真」（改前按名命中的行都带对键）、「通道验证」、「防回退」与 db.ts 四步断言
 *
 * ⚠️ 本脚本是纯静态的（不连数据库）：它校验的是「种子 + 源码」——
 *    种子就是部署时写进库里的那份，源码就是运行时读它的那份，两头都锁住即可。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pricingDefaults } from '../server/seed/pricingDefaults'
import { estimationParameters } from '../server/seed/parameterData'
import { PARAM_KEYS, PARAM_KEY_VALUES, PARAM_KEY_LABELS } from '../server/config/paramKeys'
import { DATA_ENUMS } from '../server/config/dataTables'
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

/** 去掉整行注释（`//` / `/*` / `*` / `--`）后再做「有没有这段代码」的判断。
 *  ⚠️ 反向验证时真踩到过这个空子：把一处 ALTER 注释掉，断言仍在**注释文本**里搜到了关键字，
 *     于是「老库加列被删」这种真实退化被判成全绿 —— 松散匹配。注释掉的代码等于不存在。 */
function stripComments(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--'))
    })
    .join('\n')
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
// ══ 四、取数不靠名字：引擎只认参数键 ═══════════════════════════════════
// 由来（2026-09-18）：「配置真实性」第二轮。引擎原来按 param_name 的**中文名字面量**匹配取值
// （find(p => p.param_name === '人月折算系数') / includes('应用类型') …），
// 于是「后台改个中文名」＝「静默改行为」：匹配不到就掉兜底值。
// 最坑的是兜底 HM(174) 恰好等于多数标准的取值 —— 失配被数值巧合掩盖得干干净净，
// 只有北京 DB11/T 1010（176）会悄悄变 174，金额小改、不报错、不留痕。
// 现在引擎只认 param_key（唯一事实源 server/config/paramKeys.ts），本段把两头锁住。
// 一律在「去注释后」的源码上判断：注释掉的代码不算接线（反向验证踩过这个空子）。
const engineSrc = stripComments(readSrc('server/utils/pricingStandards.ts'))
const dbSrc = stripComments(readSrc('server/utils/db.ts'))

// (1) 搬迁保真 —— 期望值是**独立于实现**的下界清单：
//     照抄改造前源码里的匹配写法人工整理出「哪些中文名会被引擎命中、各自该得什么键」。
//     漏一个 → 那个参数掉兜底值 → 金额变。这是本段最重要的一条。
const WAS_NAME_MATCH: [string, string][] = [
  ['人月折算系数', 'hm'],
  ['平均人力成本费率', 'rate'],
  ['基准人月费率', 'rate'],
  ['应用类型调整因子', 'app_type_factor'],
  ['开发平台调整因子', 'platform_factor'],
  ['开发语言/平台调整因子', 'platform_factor'],
  ['开发团队背景调整因子', 'team_factor'],
  ['非功能性特征调整因子', 'nonfunc_factor'],
  ['规模变更因子', 'scale_change_factor'],
  ['规模调整因子', 'scale_change_factor'],
  ['规模调整因子CF', 'scale_change_factor'],
  ['软件功能规模调整因子（VAF）', 'scale_change_factor'],
  ['复用度调整因子', 'reuse_factor'],
  ['复用系数', 'reuse_factor'],
]
const wantKey = new Map(WAS_NAME_MATCH)
const noKeyRows: string[] = []
const wrongKeyRows: string[] = []
let nameHitRows = 0
for (const p of estimationParameters) {
  const want = wantKey.get(p.param_name)
  if (!want) continue
  nameHitRows++
  if (!p.param_key) noKeyRows.push(`${p.standard_id} / ${p.param_name}`)
  else if (p.param_key !== want) wrongKeyRows.push(`${p.standard_id} / ${p.param_name}（应 ${want}，实 ${p.param_key}）`)
}
results.push(['改造前引擎按名字命中的每一行，现在都带上了正确的参数键',
  noKeyRows.length === 0 && wrongKeyRows.length === 0,
  noKeyRows.length || wrongKeyRows.length
    ? [noKeyRows.length ? `漏键：${noKeyRows.join('；')}` : '',
       wrongKeyRows.length ? `键不对：${wrongKeyRows.join('；')}` : ''].filter(Boolean).join(' ｜ ')
    : `${nameHitRows} 行全部对上（覆盖 ${WAS_NAME_MATCH.length} 种中文名）`])

// (2) 下界：每个参数键都还真的被某一行用着（防「整块删掉 / 键被摘掉」后无人察觉）
const unusedKeys = PARAM_KEY_VALUES.filter((k) => !estimationParameters.some((p) => p.param_key === k))
results.push(['每个参数键都还有行在用（防整块被删）', unusedKeys.length === 0,
  unusedKeys.length ? `没有任何行在用：${unusedKeys.join(', ')}` : `${PARAM_KEY_VALUES.length} 个键均有行使用`])

// (3) 种子里出现的键必须在 paramKeys.ts 登记过（防拼成 hn / pdr_devv 这种静默失配）
const strayKeys = [...new Set(estimationParameters.filter((p) => p.param_key).map((p) => p.param_key!))]
  .filter((k) => !PARAM_KEY_VALUES.includes(k))
results.push(['种子里的参数键都在 paramKeys.ts 登记过（没拼错）', strayKeys.length === 0,
  strayKeys.length ? `未登记：${strayKeys.join(', ')}` : '全部已登记'])

// (4) 同一个中文名不能对应两个键 —— 否则回填时这一行写成哪个键全看顺序
const keySets = new Map<string, Set<string>>()
for (const p of estimationParameters) {
  if (!p.param_key) continue
  if (!keySets.has(p.param_name)) keySets.set(p.param_name, new Set())
  keySets.get(p.param_name)!.add(p.param_key)
}
const ambiguous = [...keySets].filter(([, s]) => s.size > 1).map(([n, s]) => `${n} → ${[...s].join('/')}`)
results.push(['中文名与参数键一一对应（回填不会写错）', ambiguous.length === 0,
  ambiguous.length ? ambiguous.join('；') : `${keySets.size} 种中文名各对应唯一键`])

// (5) 通道验证：每个键都必须真的出现在引擎源码里（接线到位）。
//     ⚠️ 与第 (6) 条一正一反：这条证明「键接上了」，那条证明「名字没接回去」。
const notWired = PARAM_KEY_VALUES.filter((k) => !new RegExp(`['"]${k}['"]`).test(engineSrc))
results.push(['每个参数键都真的接在引擎源码里（不是只在种子里存在）', notWired.length === 0,
  notWired.length ? `引擎里搜不到：${notWired.join(', ')}` : `${PARAM_KEY_VALUES.length} 个键均在 pricingStandards.ts 出现`])

// (6) 防回退：引擎不许再按中文名匹配取值。
//     ⚠️ 锚定「比较动作」而不是「有没有出现 param_name 这个词」——
//       注释里提一句 param_name 不该报红，真按名字取值必须报红。
const NAME_MATCH: RegExp[] = [
  /param_name\s*===?\s*['"]/,
  /param_name\s*!==?\s*['"]/,
  /param_name\.includes\s*\(/,
  /param_name\.startsWith\s*\(/,
]
const nameMatchHits: string[] = []
for (const rel of RUNTIME_FILES) {
  const src = stripComments(readSrc(rel))
  for (const re of NAME_MATCH) if (re.test(src)) nameMatchHits.push(`${rel} → ${re.source}`)
}
results.push(['引擎不再按中文名匹配取值（改按参数键）', nameMatchHits.length === 0,
  nameMatchHits.length ? nameMatchHits.join('；') : `${RUNTIME_FILES.length} 个运行时文件已核对`])

// (7) 后台必须给每个键配中文标签 —— 否则列表里会露出 hm / pdr_dev 这种英文
const keyEnum = DATA_ENUMS['estimation_parameters.param_key'] || {}
const noLabel = PARAM_KEYS.filter((k) => !keyEnum[k.key] || !/[\u4e00-\u9fa5]/.test(keyEnum[k.key])).map((k) => k.key)
results.push(['后台给每个参数键都配了中文标签（列表不露英文）', noLabel.length === 0,
  noLabel.length ? `缺中文：${noLabel.join(', ')}` : `${PARAM_KEYS.length} 个键全部有中文`])

// (8) db.ts 四处必须同步：建表 / 幂等加列 / 首次灌入 / 老库回填。
//     ⚠️ 少任何一处都会出问题，尤其回填 —— 少它则已上线的库（行数 > 0）永远拿不到键，
//       而引擎只认键 → 线上所有标准一起掉兜底值。这类「本地测不出、上线才炸」必须用断言挡。
const dbSteps: [string, boolean][] = [
  ['建表含 param_key 列', /param_key\s+TEXT/.test(dbSrc)],
  ['幂等 ALTER 加列（老库升级用）', /ALTER TABLE estimation_parameters ADD COLUMN IF NOT EXISTS param_key/.test(dbSrc)],
  ['首次灌入写 param_key', /param_name,\s*param_key,\s*param_type/.test(dbSrc)],
  ['老库幂等回填（空则填、非空保留）', /UPDATE estimation_parameters SET param_key/.test(dbSrc)],
]
const dbMissing = dbSteps.filter(([, ok]) => !ok).map(([n]) => n)
results.push(['db.ts 四步齐全（建表 / 加列 / 灌入 / 回填）', dbMissing.length === 0,
  dbMissing.length ? `缺：${dbMissing.join('、')}` : '四处改动齐全'])

// (9) 回填块必须在「首次灌入」那个分支**之外**（在分支里的话，行数 > 0 的老库永远不执行它）。
const seedLogIdx = dbSrc.indexOf('[seed] estimation_parameters 已灌')
const backfillIdx = dbSrc.indexOf('UPDATE estimation_parameters SET param_key')
results.push(['回填不在「首次灌入」分支里（否则老库永不回填）',
  seedLogIdx >= 0 && backfillIdx > seedLogIdx,
  backfillIdx > seedLogIdx ? '回填在灌入分支之后，每次启动都会补空值' : `顺序可疑：灌入日志 ${seedLogIdx} / 回填 ${backfillIdx}`])

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
console.log(`✓ 通过：${results.length} 项（搬迁保真 / 算法自洽 / 未回退 / 取数不靠名字）`)
console.log('')
