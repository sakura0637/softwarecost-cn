import db from '../../utils/db'
import { buildSiteTree } from '../../utils/omDeviceMatcher'

// 设备价格库 → 运维测算：站点树（管理处 → 子站 + 各自设备行数）
//
// 供测算页的「站点筛选」弹窗使用。单独拆出来的原因：
// 树只有 169 个子站、几 KB，页面一进来就能先画出来；
// 而设备明细动辄上千行，等用户确认要哪些站点后再用 POST /api/om/devices 取。
//
// 汇总站（各管理处的「全站设备汇总」）在这里就被剔除了 —— 它与明细重复，
// 误选会让运维费翻倍。总调中心没有真实子站，其汇总站 is_summary 为 false，保留。
export default defineEventHandler(async () => {
  const rows = (await db
    .prepare(
      `SELECT station, subsite, is_summary
         FROM v_device_prices
        WHERE is_summary IS NOT TRUE AND station IS NOT NULL AND station <> ''`
    )
    .all()) as Array<{ station: string; subsite: string; is_summary: boolean }>

  const stationTree = buildSiteTree(rows)
  return {
    stationTree,
    stations: stationTree.map((t) => t.station),
    allRows: stationTree.reduce((a, n) => a + n.count, 0),
    subsiteCount: stationTree.reduce((a, n) => a + n.subsites.length, 0),
  }
})
