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
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { standards } from '../composables/useStandards'
import { estimationBenchmarks, provincialPricing } from '../server/seed/estimationData'
import { cityRates, estimationParameters } from '../server/seed/parameterData'
import {
  omWageBases, omFactors, omRateItems, omC1Benchmarks,
  omQuotaItems, omStationTypes, omDeviceC1Maps,
} from '../server/seed/omData'
import { DATA_TABLES, DATA_ENUMS } from '../server/config/dataTables'

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
console.log(`✓ 通过：${results.length} 项（表说明齐全、编码全中文、列引用有效）`)
console.log('')
