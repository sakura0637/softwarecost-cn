// 设备台账对齐 · 目标态生成器（本地跑，不连库）
//
// 输入
//   server/seed/device_prices_seed.json   库（种子）现状
//   _tmp_ledger/excel_ledger_v2.json      桌面台账解析基线
//   scripts/device_align_rules.mjs        映射规则
//
// 输出
//   server/seed/device_prices_seed.json     对齐后的「目标态」种子（就地更新，git 可审阅）
//   _tmp_ledger/device_prices_seed_before.json  对齐前的快照（便于比对与回滚）
//   _tmp_ledger/device_align_report.md      差异报告（人读）
//   _tmp_ledger/device_align_stats.json     统计（机读，供校验断言）
//
// 对齐口径：以台账为准 · 库独有全部保留 · 单价不动
//   1) 库行的 站点/分类 按规则改写
//   2) 两边都有的设备 → 数量以台账为准
//   3) 台账有、库没有 → 新增（价格留空待补）
//   4) 库有、台账没有 → 原样保留
//
// 用法：node scripts/gen_device_align_seed.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SITE_MERGE, CAT_MAP, CAT_MAP_EXCEL, canonicalCat, buildSiteMap,
  mergedAwaySites, normName, normUnit,
} from './device_align_rules.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))
const wr = (p, s) => fs.writeFileSync(path.join(ROOT, p), s)

// 输入种子可被 --lib=<path> 覆盖：种子就地更新后再跑一次会全 0（幂等），
// 要重出「真实差异」报告就喂对齐前的历史快照，例如
//   node scripts/gen_device_align_seed.mjs --lib=_tmp_ledger/seed_head_10288.json
const LIB_PATH = (process.argv.find((a) => a.startsWith('--lib=')) || '').slice('--lib='.length)
  || 'server/seed/device_prices_seed.json'
const LIB = rd(LIB_PATH)
const EX = rd('_tmp_ledger/excel_ledger_v2.json')

// 新增行是否带上台账里的采购单价（只对 4 张「在建实体环境」sheet 有效）。
// 默认不带 —— 与主人「先留空」的口径一致；需要时加 --with-buy-price。
const WITH_BUY_PRICE = process.argv.includes('--with-buy-price')

const siteMap = buildSiteMap()
const away = new Set(mergedAwaySites().map(([a, b]) => a + '\u0000' + b))

// ── 匹配键：名称 + 单位 (+ 品牌型号) ──
const K3 = (r) => normName(r.name) + '\u0001' + normUnit(r.unit) + '\u0001' + normName(r.brand_model)
const K2 = (r) => normName(r.name) + '\u0001' + normUnit(r.unit)
const K1 = (r) => normName(r.name)

// ── 1) Excel 索引（按目标站）──
const exBySite = new Map()
EX.forEach((r, i) => {
  if (!r.station) return
  const sk = r.station + '\u0000' + (r.subsite || '')
  if (!exBySite.has(sk)) exBySite.set(sk, [])
  exBySite.get(sk).push({ ...r, _i: i, _used: false })
})
// 站内「名称+单位」计数：用于判断某设备在本站是否唯一
const exK2Count = new Map()
for (const [sk, list] of exBySite) {
  for (const r of list) {
    const k = sk + '\u0000' + K2(r)
    exK2Count.set(k, (exK2Count.get(k) || 0) + 1)
  }
}

// ── 2) 改写库行（先只改站点/分类，数量留到索引建好后处理）──
const out = []
const stat = {
  libIn: LIB.length,
  qtyChanged: 0, qtySame: 0,
  siteMoved: 0, catChanged: 0, catSkewFixed: 0,
  matchBy: { k3: 0, k2: 0, k1: 0 },
  siteMoves: new Map(),   // 'old -> new': n
  catMoves: new Map(),    // 'old -> new': n
}
const catsBefore = new Map(), catsAfter = new Map()
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)

for (const r of LIB) {
  const skOld = (r.station || '') + '\u0000' + (r.subsite || '')
  const tgt = siteMap.get(skOld)
  const nStation = tgt ? tgt[0] : r.station
  const nSubsite = tgt ? tgt[1] : r.subsite
  if (tgt) {
    stat.siteMoved++
    bump(stat.siteMoves, `${r.station}/${r.subsite} → ${nStation}/${nSubsite}`)
  }

  const [nc, ns] = canonicalCat(r.category, r.subcategory, CAT_MAP)
  bump(catsBefore, `${r.category || '(空)'}/${r.subcategory || '(空)'}`)

  out.push({ ...r, station: nStation, subsite: nSubsite, category: nc, subcategory: ns })
  bump(catsAfter, `${nc || '(空)'}/${ns || '(空)'}`)
}

// 站内「名称+单位」计数（库侧，映射后）
const libK2Count = new Map()
for (const r of out) {
  const k = (r.station || '') + '\u0000' + (r.subsite || '') + '\u0000' + K2(r)
  libK2Count.set(k, (libK2Count.get(k) || 0) + 1)
}

// ── 3) 数量订正：仅当「名称+单位」在库侧与台账侧都唯一 ──
// 为什么加这个限制：库把同一设备分批录入成多行（同名称同单位、不同品牌型号），
// 若逐行硬套台账的一行，会把总量算成倍数（实测：接入交换机 2+2 被改成 4+2）。
// 两侧都唯一 = 可以安全地一一对应；任一侧多行则交回「库独有保留」不动。
for (const row of out) {
  const sk = (row.station || '') + '\u0000' + (row.subsite || '')
  const list = exBySite.get(sk)
  if (!list) continue
  if ((libK2Count.get(sk + '\u0000' + K2(row)) || 0) !== 1) continue
  if ((exK2Count.get(sk + '\u0000' + K2(row)) || 0) !== 1) continue
  const ex = list.find((x) => K2(x) === K2(row))
  if (!ex) continue
  ex._used = true
  if (ex.qty !== null && ex.qty !== undefined && Number(ex.qty) !== Number(row.qty)) {
    row.qty = ex.qty
    stat.qtyChanged++
  } else stat.qtySame++
}

if (stat.catChanged === 0) {
  // 统计分类实际变化量（用于报告）
  for (let i = 0; i < LIB.length; i++) {
    if ((LIB[i].category || '') !== (out[i].category || '') ||
        (LIB[i].subcategory || '') !== (out[i].subcategory || '')) stat.catChanged++
  }
}

// ── 4) 台账独有 → 新增 ──
// 判据用「名称+单位在库中是否已存在」而非逐行匹配：库里同设备可能有多行，
// 只要该设备在本站出现过，就不再新增（避免重复录入）。
const added = []
for (const [sk, list] of exBySite) {
  const [st, sub] = sk.split('\u0000')
  for (const r of list) {
    if (r._used) continue
    if (libK2Count.has(sk + '\u0000' + K2(r))) continue
    const [nc, ns] = canonicalCat(r.category, r.subcategory, CAT_MAP_EXCEL)
    added.push({
      station: st, subsite: sub,
      category: nc, subcategory: ns,
      name: r.name, unit: r.unit, brand_model: r.brand_model,
      qty: r.qty,
      // 单价：台账的「运维费单价」与库的 unit_price（设备采购价）口径不同，
      // 不能混填；仅当台账明确给出采购单价（在建实体环境 sheet）时才带上，
      // 由 --with-buy-price 开关决定是否写入。
      unit_price: WITH_BUY_PRICE ? (r.buy_price ?? null) : null,
      _buy_price: r.buy_price ?? null,
      _src: r.sheet,
    })
  }
}
const finalRows = out.concat(added.map(({ _buy_price, _src, ...r }) => r))

// ── 4) 报告 ──
const siteCountBefore = new Set(LIB.map((r) => (r.station || '') + '/' + (r.subsite || '')))
const siteCountAfter = new Set(finalRows.map((r) => (r.station || '') + '/' + (r.subsite || '')))
const byCat = (rows) => {
  const m = new Map()
  for (const r of rows) bump(m, (r.category || '(空)') + ' / ' + (r.subcategory || '(空)'))
  return m
}
const catFinal = byCat(finalRows)

const L = []
L.push('# 设备台账对齐 · 目标态报告')
L.push('')
L.push('生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }))
L.push('')
L.push('## 一、总览')
L.push('')
L.push('| 指标 | 对齐前 | 对齐后 |')
L.push('|---|---:|---:|')
L.push(`| 行数 | ${LIB.length.toLocaleString()} | ${finalRows.length.toLocaleString()} |`)
L.push(`| 子站数 | ${siteCountBefore.size} | ${siteCountAfter.size} |`)
L.push(`| 站点搬迁行 | — | ${stat.siteMoved.toLocaleString()} |`)
L.push(`| 分类改写行 | — | ${stat.catChanged.toLocaleString()} |`)
L.push(`| 数量订正行 | — | ${stat.qtyChanged.toLocaleString()} |`)
L.push(`| 新增行（台账独有） | — | ${added.length.toLocaleString()} |`)
L.push(`| 数量未变行（两边共有） | — | ${stat.qtySame.toLocaleString()} |`)
L.push('')
L.push('## 二、站点动作')
L.push('')
L.push('### 2.1 合并')
for (const g of SITE_MERGE) {
  L.push(`- **${g.station}**：\`${g.host}\` → \`${g.to}\`` +
    (g.sources.length ? `；源站 ${g.sources.map((s) => '`' + s + '`').join('、')} 并入后删除` : ''))
}
L.push('')
L.push('### 2.2 改名 / 重挂（行数）')
L.push('')
for (const [k, v] of [...stat.siteMoves.entries()].sort((a, b) => b[1] - a[1])) {
  L.push(`- ${k}  ×${v}`)
}
L.push('')
L.push('## 三、分类改写对照')
L.push('')
L.push('| 对齐前 | 对齐后 | 行数 |')
L.push('|---|---|---:|')
const catPairs = new Map()
for (let i = 0; i < LIB.length; i++) {
  const a = `${LIB[i].category || '(空)'} / ${LIB[i].subcategory || '(空)'}`
  const b = `${out[i].category || '(空)'} / ${out[i].subcategory || '(空)'}`
  if (a !== b) bump(catPairs, a + '\u0000' + b)
}
for (const [k, v] of [...catPairs.entries()].sort((a, b) => b[1] - a[1])) {
  const [a, b] = k.split('\u0000')
  L.push(`| ${a} | ${b} | ${v} |`)
}
L.push('')
L.push('## 四、对齐后的分类分布')
L.push('')
L.push('| 分类 / 子分类 | 行数 |')
L.push('|---|---:|')
for (const [k, v] of [...catFinal.entries()].sort((a, b) => b[1] - a[1])) {
  L.push(`| ${k} | ${v} |`)
}
L.push('')
L.push('## 五、新增行（台账独有）按站点')
L.push('')
const addBySite = new Map()
for (const r of added) bump(addBySite, r.station + ' / ' + r.subsite)
L.push('| 站点 | 新增行 |')
L.push('|---|---:|')
for (const [k, v] of [...addBySite.entries()].sort((a, b) => b[1] - a[1])) {
  L.push(`| ${k} | ${v} |`)
}
L.push('')
L.push('## 六、注意事项')
L.push('')
L.push(`- 新增行中带台账采购单价的共 ${added.filter((r) => r._buy_price != null && r._buy_price > 0).length} 行` +
  '（全部来自 4 张「在建实体环境」sheet）。**默认不写入单价**，与主人「先留空」的口径一致；')
L.push('  需要写入时用生成器的 `--with-buy-price` 选项。')
L.push('- 台账的「运维费单价」与库的 unit_price（设备采购价）是两个口径，全程不混填。')

wr('_tmp_ledger/device_align_report.md', L.join('\n'))
wr('_tmp_ledger/device_prices_seed_before.json', JSON.stringify(LIB, null, 0))
// 就地更新生产种子：设备价格库的唯一事实源就是它，对齐结果理应落在这里
wr('server/seed/device_prices_seed.json', JSON.stringify(finalRows, null, 0))

const statsOut = {
  libIn: LIB.length, outRows: finalRows.length, added: added.length,
  siteMoved: stat.siteMoved, catChanged: stat.catChanged, qtyChanged: stat.qtyChanged,
  qtySame: stat.qtySame,
  siteCountBefore: siteCountBefore.size, siteCountAfter: siteCountAfter.size,
  addedWithBuyPrice: added.filter((r) => r._buy_price != null && r._buy_price > 0).length,
  mergedHosts: SITE_MERGE.map((g) => g.station + '/' + g.host + '→' + g.to),
  awaySites: [...away],
}
wr('_tmp_ledger/device_align_stats.json', JSON.stringify(statsOut, null, 1))

console.log('=== 设备台账对齐 · 目标态 ===')
console.log(`库行 ${LIB.length} → 目标 ${finalRows.length}（新增 ${added.length}）`)
console.log(`子站 ${siteCountBefore.size} → ${siteCountAfter.size}`)
console.log(`站点搬迁 ${stat.siteMoved} 行 / 分类改写 ${stat.catChanged} 行 / 数量订正 ${stat.qtyChanged} 行`)
console.log(`新增行中带采购单价 ${statsOut.addedWithBuyPrice} 行（默认不写入）`)
console.log('\n分类改写对照：')
for (const [k, v] of [...catPairs.entries()].sort((a, b) => b[1] - a[1])) {
  const [a, b] = k.split('\u0000')
  console.log(`  ${a.padEnd(34)} → ${b.padEnd(34)} ×${v}`)
}
console.log('\n新增行按站点：')
for (const [k, v] of [...addBySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${k.padEnd(30)} ${v}`)
}
