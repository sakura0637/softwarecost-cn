import db from '../../utils/db'
import { getQuery } from 'h3'

// 筛选项。
// 不带参数 → 返回全部 stations / categories（兼容旧调用）。
// 带 station → 额外返回该站的 subsites（子站，含「全站设备汇总」）与 subcategories（子分类）。
// 带 station + category → subcategories 收敛为该分类下的子分类。
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const station = String(q.station || '').trim()
  const category = String(q.category || '').trim()

  const stations = (
    db.prepare('SELECT DISTINCT station FROM device_prices ORDER BY station').all() as any[]
  ).map((r) => r.station)
  const categories = (
    db
      .prepare("SELECT DISTINCT category FROM device_prices WHERE category IS NOT NULL AND category <> '' ORDER BY category")
      .all() as any[]
  ).map((r) => r.category)

  const resp: any = { stations, categories }

  if (station) {
    const subsites = (
      db
        .prepare(
          'SELECT DISTINCT subsite FROM device_prices WHERE station = ? AND subsite IS NOT NULL AND subsite <> ? ORDER BY subsite'
        )
        .all(station, '') as any[]
    ).map((r: any) => r.subsite)
    resp.subsites = subsites

    const subParams: any[] = [station]
    let subWhere = 'station = ?'
    if (category) {
      subWhere += ' AND category = ?'
      subParams.push(category)
    }
    const subcategories = (
      db
        .prepare(
          `SELECT DISTINCT subcategory FROM device_prices WHERE ${subWhere} AND subcategory IS NOT NULL AND subcategory <> ? ORDER BY subcategory`
        )
        .all(...subParams, '') as any[]
    ).map((r: any) => r.subcategory)
    resp.subcategories = subcategories
  }

  return resp
})
