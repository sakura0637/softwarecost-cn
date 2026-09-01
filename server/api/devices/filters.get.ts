import db from '../../utils/db'
import { getQuery } from 'h3'

// 设备价格库筛选项。
// 【2026-09-01】数据源由宽表 device_prices 改为范式化三表：
//   stations      → stations 表中 parent_id IS NULL 的管理处
//   categories    → devices 表的顶层分类去重（分类是设备的固有属性）
//   subsites      → 指定管理处下的子站（默认排除汇总节点，否则选了查不到明细）
//   subcategories → devices 表的子分类去重，可按站点/分类收敛
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const station = String(q.station || '').trim()
  const category = String(q.category || '').trim()

  const stations = (
    await db.prepare('SELECT name FROM stations WHERE parent_id IS NULL ORDER BY name').all() as any[]
  ).map((r) => r.name)

  const categories = (
    await db
      .prepare("SELECT DISTINCT category FROM devices WHERE category IS NOT NULL AND category <> '' ORDER BY category")
      .all() as any[]
  ).map((r) => r.category)

  const resp: any = { stations, categories }

  // 子站：必须选了站点才聚合；排除汇总节点（「全站设备汇总」是合计，不是真实子站）
  if (station) {
    const subsites = (
      await db
        .prepare(
          `SELECT s.name FROM stations s
           JOIN stations p ON p.id = s.parent_id
           WHERE p.name = ? AND NOT s.is_summary
           ORDER BY s.name`
        )
        .all(station) as any[]
    ).map((r) => r.name)
    resp.subsites = subsites
  }

  // 子分类：支持按站点/分类收敛；未传站点时返回全局子分类聚合
  {
    const params: any[] = []
    const conds: string[] = ['d.subcategory IS NOT NULL', "d.subcategory <> ?"]
    params.push('')
    let sql = 'SELECT DISTINCT d.subcategory FROM devices d'
    if (station) {
      // 站点在视图里是父级（管理处）名，需沿 stations 两级关联
      sql += ` JOIN station_devices sd ON sd.device_id = d.id
               JOIN stations s ON s.id = sd.subsite_id
               LEFT JOIN stations p ON p.id = s.parent_id`
      conds.push('COALESCE(p.name, s.name) = ?')
      params.push(station)
    }
    if (category) {
      conds.push('d.category = ?')
      params.push(category)
    }
    sql += ' WHERE ' + conds.join(' AND ') + ' ORDER BY d.subcategory'
    const subcategories = (await db.prepare(sql).all(...params) as any[]).map((r) => r.subcategory)
    resp.subcategories = subcategories
  }

  return resp
})
