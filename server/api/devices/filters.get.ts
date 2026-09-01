import db from '../../utils/db'
import { getQuery } from 'h3'

// 设备价格库筛选项。
// 【2026-09-01】数据源由宽表 device_prices 改为范式化三表：
//   stations      → stations 表中 parent_id IS NULL 的管理处
//   categories    → devices 表的顶层分类去重（分类是设备的固有属性）
//   subsites      → 指定管理处下的子站（默认排除汇总节点，否则选了查不到明细）
//   subcategories → devices 表的子分类去重，可按站点/分类收敛
// 【2026-09-01 多选增强】station 入参支持多值（重复参数或逗号分隔），
//   返回所选站点下的子站「并集」（按所选站点并集）；未传站点时返回全部 level=2 子站。
// 【2026-09-01 分组勾选】新增 stationTree / categoryTree，用于导出弹窗的二级分组勾选。

function toArray(v: any): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String).filter((s) => s !== '')
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const stations = toArray(q.station)
  const categories = toArray(q.category)

  const stationsList = (
    await db.prepare('SELECT name FROM stations WHERE parent_id IS NULL ORDER BY name').all() as any[]
  ).map((r) => r.name)

  const categoriesList = (
    await db
      .prepare("SELECT DISTINCT category FROM devices WHERE category IS NOT NULL AND category <> '' ORDER BY category")
      .all() as any[]
  ).map((r) => r.category)

  const resp: any = { stations: stationsList, categories: categoriesList }

  // 子站：所选站点下的子站并集（排除汇总节点）；未选站点 → 全部 level=2 子站
  {
    let sql = `SELECT DISTINCT s.name FROM stations s`
    const conds: string[] = ['s.level = 2', 'NOT s.is_summary']
    const params: any[] = []
    if (stations.length) {
      sql += ` JOIN stations p ON p.id = s.parent_id`
      conds.push(`p.name IN (${stations.map(() => '?').join(',')})`)
      for (const st of stations) params.push(st)
    }
    sql += ' WHERE ' + conds.join(' AND ') + ' ORDER BY s.name'
    resp.subsites = (await db.prepare(sql).all(...params) as any[]).map((r) => r.name)
  }

  // 子分类：支持按站点集/分类集收敛；未传则全局子分类去重
  {
    const params: any[] = []
    const conds: string[] = ['d.subcategory IS NOT NULL', "d.subcategory <> ?"]
    params.push('')
    let sql = 'SELECT DISTINCT d.subcategory FROM devices d'
    if (stations.length) {
      sql += ` JOIN station_devices sd ON sd.device_id = d.id
               JOIN stations s ON s.id = sd.subsite_id
               LEFT JOIN stations p ON p.id = s.parent_id`
      conds.push(`COALESCE(p.name, s.name) IN (${stations.map(() => '?').join(',')})`)
      for (const st of stations) params.push(st)
    }
    if (categories.length) {
      conds.push(`d.category IN (${categories.map(() => '?').join(',')})`)
      for (const c of categories) params.push(c)
    }
    sql += ' WHERE ' + conds.join(' AND ') + ' ORDER BY d.subcategory'
    resp.subcategories = (await db.prepare(sql).all(...params) as any[]).map((r) => r.subcategory)
  }

  // 站点-子站分组树：按管理处分组列出子站，用于导出弹窗二级勾选
  {
    const rows = (await db.prepare(`
      SELECT p.name AS station, s.name AS subsite
      FROM stations s
      JOIN stations p ON p.id = s.parent_id
      WHERE s.level = 2 AND NOT s.is_summary
      ORDER BY p.name, s.name
    `).all() as any[])
    const map = new Map<string, string[]>()
    for (const r of rows) {
      const arr = map.get(r.station) || []
      arr.push(r.subsite)
      map.set(r.station, arr)
    }
    resp.stationTree = stationsList.map((station) => ({
      station,
      subsites: map.get(station) || [],
    }))
  }

  // 分类-子分类分组树：按分类分组列出子分类
  {
    const rows = (await db.prepare(`
      SELECT d.category, d.subcategory
      FROM devices d
      WHERE d.category IS NOT NULL AND d.category <> ''
        AND d.subcategory IS NOT NULL AND d.subcategory <> ''
      ORDER BY d.category, d.subcategory
    `).all() as any[])
    const map = new Map<string, string[]>()
    for (const r of rows) {
      const arr = map.get(r.category) || []
      if (!arr.includes(r.subcategory)) arr.push(r.subcategory)
      map.set(r.category, arr)
    }
    resp.categoryTree = categoriesList.map((category) => ({
      category,
      subcategories: map.get(category) || [],
    }))
  }

  return resp
})
