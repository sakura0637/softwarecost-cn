// 由 scripts/parse_device_ledger.py 的解析产物生成「台账 v3.4 目标态种子」
//
// 输入：_tmp_ledger/excel_ledger_v2.json（parse_device_ledger.py 产出，8319 行）
// 输出：server/seed/ledger_v34_target.json（随 git 上服务器，供 apply_ledger_align.mjs 用）
//
// 口径：
//   - station/subsite/category/subcategory/name/brand_model/unit 原样带过
//   - qty 保留（null 视为未填 → null）
//   - ⚠️ **不带单价**：台账 ops_price 是运维月费、库 unit_price 是采购价，两个口径，绝不互灌
//
// 用法：node scripts/gen_ledger_target.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
function findRoot() {
  const cands = []
  let d = HERE
  for (let i = 0; i < 6; i++) { cands.push(d); d = dirname(d) }
  cands.push(process.cwd())
  for (const c of cands) {
    if (existsSync(join(c, 'server', 'seed', 'device_prices_seed.json'))) return c
  }
  return process.cwd()
}
const ROOT = findRoot()
const SRC = process.argv.find((a) => a.startsWith('--in='))?.slice(5) ||
  join(ROOT, '_tmp_ledger', 'excel_ledger_v2.json')
const OUT = join(ROOT, 'server', 'seed', 'ledger_v34_target.json')

if (!existsSync(SRC)) {
  console.error(`✗ 找不到解析产物 ${SRC}`)
  console.error('  先跑：python scripts/parse_device_ledger.py')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const rows = (Array.isArray(raw) ? raw : raw.rows ?? []).map((r) => ({
  station: r.station ?? '',
  subsite: r.subsite ?? '',
  category: r.category ?? null,
  subcategory: r.subcategory ?? null,
  name: r.name ?? '',
  brand_model: r.brand_model ?? null,
  unit: r.unit ?? null,
  qty: r.qty == null ? null : Number(r.qty),
}))

// ⚠️ **同名累加**（主人 2026-09-28 明确）：台账同站同名设备的数量**全部相加**。
//    台账"同名多行"有两种成因，都必须累加而非去重：
//    ① 主表合计行之后另起的补充区块（如保定 应急工作站 = 主表 2 台 + 补充 1 台 → 3 台）
//    ② 主表内部就录了多组同名设备（如总调中心 接入交换机 qty=1/4/4 → 9 台）
// 合并键：管理处 + 子站 + 分类 + 子分类 + 名称 + 品牌型号 + 单位
// （品牌/单位必须参与 —— 同站同名的不同品牌是不同设备，不能混加）
const merged = new Map() // key -> row
let mergedRows = 0
for (const r of rows) {
  const k = [r.station, r.subsite, r.category ?? '', r.subcategory ?? '', r.name, r.brand_model ?? '', r.unit ?? ''].join('\u0000')
  const cur = merged.get(k)
  if (!cur) {
    merged.set(k, r)
    continue
  }
  // 累加数量：null 视为"未填"，参与加法但全 null 保持 null（不静默变 0）
  if (cur.qty == null && r.qty == null) continue
  cur.qty = (cur.qty ?? 0) + (r.qty ?? 0)
  mergedRows++
}
const targets = [...merged.values()]

const out = {
  source: '设备台账_数据对齐版v3.4_0919 - 副本.xlsx',
  generatedAt: new Date().toISOString(),
  note: '目标态 = 台账全量（同站同名同品牌同单位**数量累加**）；不含单价（台账单价是运维月费，与库采购价不同口径）',
  total: targets.length,
  rows: targets,
}
writeFileSync(OUT, JSON.stringify(out, null, 1))

console.log(`✓ 台账目标态已生成：${OUT}`)
console.log(`  解析行 ${rows.length} → 同名累加后 ${targets.length}（合并 ${mergedRows} 次叠行）`)
const dedup = targets
const byStation = {}
for (const r of dedup) byStation[r.station] = (byStation[r.station] || 0) + 1
for (const [k, v] of Object.entries(byStation).sort()) console.log(`   ${k}: ${v}`)
