import db from '../../utils/db'
import { getQuery } from 'h3'

// 筛选项。
// 不带参数 → 返回全部 stations / categories（兼容旧调用）。
// 带 station → 额外返回该站的 subsites（子站，含「全站设备汇总」）与 subcategories（子分类）。
// 带 station + category → subcategories 收敛为该分类下的子分类。
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const station = String(q.station || '').trim()
  const category = String(q.category || '').trim()

  const stations = (
    await db.prepare('SELECT DISTINCT station FROM device_prices ORDER BY station').all() as any[]
  ).map((r) => r.station)
  const categories = (
    await db
      .prepare("SELECT DISTINCT category FROM device_prices WHERE category IS NOT NULL AND category <> '' ORDER BY category")
      .all() as any[]
  ).map((r) => r.category)

  const resp: any = { stations, categories }

  // 子站：必须选了站点才聚合；全部站点时不按站点过滤（但前端目前仍只在 station 非空时显示）
  if (station) {
    const subsites = (
      await db
        .prepare(
          'SELECT DISTINCT subsite FROM device_prices WHERE station = ? AND subsite IS NOT NULL AND subsite <> ? ORDER BY subsite'
        )
        .all(station, '') as any[]
    ).map((r: any) => r.subsite)
    resp.subsites = subsites
  }

  // 子分类：支持按站点/分类收敛；未传站点时返回全局子分类聚合
  {
    const subParams: any[] = []
    const conditions: string[] = ['subcategory IS NOT NULL', "subcategory <> ?"]
    subParams.push('')
    if (station) {
      conditions.push('station = ?')
      subParams.push(station)
    }
    if (category) {
      conditions.push('category = ?')
      subParams.push(category)
    }
    const subWhere = conditions.join(' AND ')
    const subcategories = (
      await db
        .prepare(
          `SELECT DISTINCT subcategory FROM device_prices WHERE ${subWhere} ORDER BY subcategory`
        )
        .all(...subParams) as any[]
    ).map((r: any) => r.subcategory)
    resp.subcategories = subcategories
  }

  return resp
})
