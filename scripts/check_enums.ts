/* 数据维护后台「可读性」护栏
 * ────────────────────────────────────────────────
 * 主人两次栽在同一类问题上：
 *   ① 界面上露出谁都看不懂的英文编码（calc=option、rate_type=development…）
 *   ② 表格里的数字看不出出处，得翻源表才知道
 * 这两类问题 esbuild / vue / permissions / dbsql 四项检查都发现不了，只能靠这里兜住。
 *
 * 断言：
 *   A. 每张注册表都有 hint（表级说明），且是分行纯文本（含 \n、不含 ** 标记）
 *   B. 种子数据里出现的英文编码值，DATA_ENUMS 必须全部覆盖（否则会原样显示给用户）
 *   C. hidden / readonly 引用的列名在 db.ts 表定义里真实存在（防手误写错列名后静默失效）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { standards } from '../composables/useStandards'
import { estimationBenchmarks, provincialPricing } from '../server/seed/estimationData'
import { cityRates, estimationParameters } from '../server/seed/parameterData'
import { pricingDefaults } from '../server/seed/pricingDefaults'
import {
  omWageBases, omFactors, omRateItems, omC1Benchmarks,
  omQuotaItems, omStationTypes, omDeviceC1Maps,
} from '../server/seed/omData'
import {
  DATA_TABLES, DATA_ENUMS, TABLE_CALC_ROLES, CALC_ROLE_LABELS, labelFor,
} from '../server/config/dataTables'

/** 定位 db.ts：打包产物在 node_modules/.cache 下，运行时的 cwd 不稳定（沙箱里可能是盘根），
 *  故把「cwd」和「产物所在目录上溯两级」两条路都试一遍。 */
function findDbTs(): string {
  const cands = [
    resolve(process.cwd(), 'server/utils/db.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../server/utils/db.ts'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/utils/db.ts'),
  ]
  const hit = cands.find((p) => existsSync(p))
  if (!hit) throw new Error(`找不到 server/utils/db.ts，已尝试：\n  ${cands.join('\n  ')}`)
  return hit
}

const seedRows: Record<string, Record<string, any>[]> = {
  standards: standards as any,
  estimation_benchmarks: estimationBenchmarks as any,
  provincial_pricing: provincialPricing as any,
  city_rates: cityRates as any,
  estimation_parameters: estimationParameters as any,
  pricing_defaults: pricingDefaults as any,
  om_wage_base: omWageBases as any,
  om_factors: omFactors as any,
  om_rate_items: omRateItems as any,
  om_c1_benchmarks: omC1Benchmarks as any,
  om_quota_items: omQuotaItems as any,
  om_station_types: omStationTypes as any,
  om_device_c1_map: omDeviceC1Maps as any,
}

/** 自由文本列（值是设备名/说明等，长得像英文时不该要求配枚举） */
const FREE_TEXT = new Set(['om_quota_items.name', 'om_quota_items.note'])

/** 确定是「编码列」而非自由文本：值全是小写英文字母 / 数字 / 下划线 */
const looksCoded = (v: any) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v)

// ── 从 db.ts 解析真实列名（与 check_dbsql 同源，避免两处口径不一致）──
function parseDbColumns(): Record<string, Set<string>> {
  const sql = readFileSync(findDbTs(), 'utf8')
  const out: Record<string, Set<string>> = {}
  const ensure = (t: string) => (out[t] ||= new Set<string>())
  const createRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g
  for (const m of sql.matchAll(createRe)) {
    const [, table, body] = m
    for (const line of body.split('\n')) {
      const cm = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+[A-Z]/)
      if (cm) ensure(table).add(cm[1])
    }
  }
  const alterRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/g
  for (const m of sql.matchAll(alterRe)) ensure(m[1]).add(m[2])
  return out
}
const dbCols = parseDbColumns()

const results: [string, boolean, string][] = []

// ── A. 每张表都要有 hint，且格式统一 ──
const noHint = DATA_TABLES.filter((t) => !t.hint || !t.hint.trim()).map((t) => t.key)
results.push(['每张维护表都有表级说明（hint）', noHint.length === 0,
  noHint.length ? `缺说明：${noHint.join(', ')}` : `${DATA_TABLES.length} 张表全有`])

const badHint = DATA_TABLES.filter((t) => t.hint && (!t.hint.includes('\n') || t.hint.includes('**')))
  .map((t) => t.key)
results.push(['表级说明是分行纯文本（页面纯文本渲染，** 会原样露出）', badHint.length === 0,
  badHint.length ? `不合格：${badHint.join(', ')}` : `${DATA_TABLES.length} 张表格式一致`])

// ── B. 英文编码必须全部有中文枚举 ──
const leaks: string[] = []
let codedCols = 0
for (const t of DATA_TABLES) {
  const rows = seedRows[t.key]
  if (!rows?.length) continue
  const cols = new Set<string>()
  rows.forEach((r) => Object.keys(r).forEach((c) => cols.add(c)))
  for (const c of cols) {
    // 主键 / 外键 / 已隐藏列 / 自由文本列不要求配枚举
    if (c === 'id' || c === t.pk || c.endsWith('_id')) continue
    if (t.fk && c in t.fk) continue
    if ((t.hidden || []).includes(c)) continue
    if (FREE_TEXT.has(`${t.key}.${c}`)) continue
    const vals = [...new Set(rows.map((r) => r[c]))].filter(looksCoded)
    if (!vals.length) continue
    codedCols++
    const key = `${t.key}.${c}`
    const map = DATA_ENUMS[key]
    if (!map) { leaks.push(`${key}（${vals.slice(0, 4).join('/')}…）`); continue }
    const miss = vals.filter((v) => !(v in map))
    if (miss.length) leaks.push(`${key} 缺 ${miss.join('/')}`)
  }
}
results.push(['英文编码列都有中文枚举（列表不会露出英文）', leaks.length === 0,
  leaks.length ? leaks.join('；') : `${codedCols} 个编码列全部覆盖`])

// ── C. hidden / readonly 列名必须真实存在 ──
const badColRef: string[] = []
for (const t of DATA_TABLES) {
  const cols = dbCols[t.key]
  if (!cols?.size) { badColRef.push(`${t.key}（db.ts 里找不到该表）`); continue }
  for (const c of [...(t.hidden || []), ...(t.readonly || [])]) {
    if (!cols.has(c)) badColRef.push(`${t.key}.${c}`)
  }
}
results.push(['hidden / readonly 引用的列名在 db.ts 里真实存在', badColRef.length === 0,
  badColRef.length ? badColRef.join(', ') : `${Object.keys(dbCols).length} 张表列名已核对`])

// ── D. 「表与算钱的关系」声明必须齐全、且必须向用户交代清楚 ──
// 背景（2026-09-17 全量审计）：后台多张表都长着「启用 / 来源 / 适用引擎」的开关模样，
// 但只有一部分真的被引擎读取 —— 于是出现「改了没反应」的困惑。这四条断言把「交代」变成强制。
const declaredKeys = Object.keys(TABLE_CALC_ROLES)
const registeredKeys = DATA_TABLES.map((t) => t.key)
const missingDecl = registeredKeys.filter((k) => !declaredKeys.includes(k))
const extraDecl = declaredKeys.filter((k) => !registeredKeys.includes(k))
results.push(['每张维护表都声明了「与算钱的关系」（role）', missingDecl.length === 0 && extraDecl.length === 0,
  missingDecl.length || extraDecl.length
    ? [missingDecl.length ? `未声明：${missingDecl.join(', ')}` : '', extraDecl.length ? `声明了但没注册：${extraDecl.join(', ')}` : '']
        .filter(Boolean).join('；')
    : `${declaredKeys.length} 张表已声明（引擎 ${declaredKeys.filter((k) => TABLE_CALC_ROLES[k].role === 'engine').length} / 页面 ${declaredKeys.filter((k) => TABLE_CALC_ROLES[k].role === 'page').length} / 无消费方 ${declaredKeys.filter((k) => TABLE_CALC_ROLES[k].role === 'dead').length} / 存档 ${declaredKeys.filter((k) => TABLE_CALC_ROLES[k].role === 'archive').length}）`])

const badRole = declaredKeys.filter((k) => !(TABLE_CALC_ROLES[k].role in CALC_ROLE_LABELS))
  .map((k) => `${k}=${TABLE_CALC_ROLES[k].role}`)
results.push(['声明的 role 取值合法（都有中文标签与说明）', badRole.length === 0,
  badRole.length ? `非法：${badRole.join(', ')}` : `${Object.keys(CALC_ROLE_LABELS).length} 种角色全部有中文标签`])

const badInertCol: string[] = []
for (const k of declaredKeys) {
  for (const c of TABLE_CALC_ROLES[k].inert || []) {
    if (!dbCols[k]?.has(c)) badInertCol.push(`${k}.${c}（db.ts 里没这列）`)
  }
}
results.push(['登记为「不参与计算」的列名在 db.ts 里真实存在', badInertCol.length === 0,
  badInertCol.length ? badInertCol.join(', ') : `${declaredKeys.reduce((n, k) => n + (TABLE_CALC_ROLES[k].inert?.length || 0), 0)} 个列名已核对`])

// 分组列的两道护栏。
// ① 列名必须真实存在：拼错列名不会抛错 —— groupBy 取的每一行都是 undefined，
//    所有行会挤进同一个空组，页面只剩一条「（未填写）」组头，静默退化成平铺，极难发现。
// ② 必须同时 hidden：组头已经把该值写在明处，行里再重复一遍纯属噪音（这正是这轮要治的病）。
const badGroupCol: string[] = []
const groupNotHidden: string[] = []
const groupedTables = DATA_TABLES.filter((t) => t.groupBy)
for (const t of groupedTables) {
  if (!dbCols[t.key]?.has(t.groupBy!)) badGroupCol.push(`${t.key}.groupBy=${t.groupBy}（db.ts 里没这列）`)
  if (!(t.hidden || []).includes(t.groupBy!)) groupNotHidden.push(`${t.key}.groupBy=${t.groupBy}`)
}
results.push(['groupBy 指向的列在 db.ts 里真实存在', badGroupCol.length === 0,
  badGroupCol.length ? badGroupCol.join(', ') : `${groupedTables.length} 张分组表的列名已核对`])
results.push(['分组列已从列表里隐藏（组头已写明该值）', groupNotHidden.length === 0,
  groupNotHidden.length ? `未隐藏：${groupNotHidden.join(', ')}` : '分组列均已 hidden，不再逐行重复'])

// 最关键的一条：登记了「不参与计算」的列，hint 里必须开一个小节（【…】标题）点名交代，
// 否则用户看到「启用 / 适用引擎」这种开关列，会以为改了有用。
// ⚠️ 必须限定在【…】小标题里，不能全篇搜 —— 否则一句顺带的「对比：费率项表的取值类型列」
//    就能让断言通过，而管理员扫一遍小标题根本看不到它（反向验证时真踩到过这个空子）。
const hintSections = (hint: string) => [...hint.matchAll(/【([^】]*)】/g)].map((m) => m[1])
const unspoken: string[] = []
for (const t of DATA_TABLES) {
  const decl = TABLE_CALC_ROLES[t.key]
  if (!decl?.inert?.length || !t.hint) continue
  const secs = hintSections(t.hint)
  for (const c of decl.inert) {
    const cn = labelFor(t.key, c)
    if (!secs.some((s) => s.includes(cn))) unspoken.push(`${t.key}.${c}（${cn}）`)
  }
}
results.push(['「不参与计算」的列都在表说明里单列小节交代了', unspoken.length === 0,
  unspoken.length ? `未交代：${unspoken.join(', ')}` : '已登记的无效列全部有独立小节写明'])

// 下界护栏：上面那条断言只保证「登记了就交代」，但**有人把登记摘掉就不会报红**。
// 所以这里锁死一份「已经确认过、绝不能悄悄摘掉」的清单 —— 摘掉即报红。
// 注意：新发现无效列 → 加进声明即可；从这份清单里删，必须同时说明为什么它其实生效了。
const KNOWN_INERT: [string, string][] = [
  ['standards', 'is_enabled'],
  ['standards', 'source'],
  ['estimation_benchmarks', 'is_active'],
  ['om_factors', 'engine'],
  ['om_factors', 'unit'],
  ['om_c1_benchmarks', 'level'],
  ['om_c1_benchmarks', 'unit'],
  ['om_quota_items', 'unit'],
]
const droppedInert = KNOWN_INERT.filter(([t, c]) => !(TABLE_CALC_ROLES[t]?.inert || []).includes(c))
  .map(([t, c]) => `${t}.${c}`)
results.push(['已确认的无效列没有被从声明里悄悄摘掉', droppedInert.length === 0,
  droppedInert.length ? `被摘掉：${droppedInert.join(', ')}` : `${KNOWN_INERT.length} 个已确认无效列仍在册`])

// 最硬的一条：拿**引擎源码**当判据，而不是拿声明互相自证。
// 由来（2026-09-18）：给 standards 加 id 桥接后，它被 pricingParams.ts 读了，但声明还停在 page ——
// 徽标继续对用户说「仅页面展示 / 改这里不影响任何金额」，而实际上改「代号」会让该标准的算法声明失配、
// 静默回落全局默认，每条功能点的点数都变。上面那些断言全都保证不了这件事：
// 它们只校验「登记了」「取值合法」，而声明本身错得理直气壮时，一条都不会红。
// 所以这里改问一句「站在引擎代码里的 SQL 提没提它」——
// 被 server/utils/ 读到的表，就不可能是「仅页面展示」。db.ts 除外：那是建表/种子/计数，
// 属自举逻辑，不是消费方（否则每张表都会因为它建表而被判成引擎表）。
const projectRoot = resolve(dirname(findDbTs()), '../..')
const engineFiles = readdirSync(resolve(projectRoot, 'server/utils'))
  .filter((f) => f.endsWith('.ts') && f !== 'db.ts')
  .map((f) => [f, readFileSync(resolve(projectRoot, 'server/utils', f), 'utf8')] as const)
const roleMismatch: string[] = []
for (const [k, decl] of Object.entries(TABLE_CALC_ROLES)) {
  if (decl.role !== 'page' && decl.role !== 'dead') continue
  const re = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+${k}\\b`, 'i')
  const hit = engineFiles.find(([, src]) => re.test(src))
  if (hit) roleMismatch.push(`${k}（声明"${CALC_ROLE_LABELS[decl.role].label}"，但 ${hit[0]} 在读它）`)
}
results.push(['声明为「仅页面展示 / 无消费方」的表，引擎代码里确实没人读', roleMismatch.length === 0,
  roleMismatch.length ? roleMismatch.join('；') : `已比对 ${engineFiles.length} 个引擎文件，无脱钩`])

// ── 输出 ──
console.log('\n══ 数据维护后台可读性护栏 ══')
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
console.log(`✓ 通过：${results.length} 项（表说明齐全、编码全中文、列引用有效、算钱角色已声明、无效列已交代）`)
console.log('')
