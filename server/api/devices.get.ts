import db from '../utils/db'
import { getQuery } from 'h3'

// 设备价格库浏览列表。
// 【2026-09-01】数据源由宽表 device_prices 改为范式化视图 v_device_prices：
//   - 单价取自 devices（全局唯一价格源），合价由视图现算（qty × unit_price），不再读取存储的合价
//   - 默认排除 is_summary（各管理处「全站设备汇总」这类合计行），避免金额重复计算
//   - 需要看汇总行时传 includeSummary=1
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const keyword = String(q.q || '').trim()
  const station = String(q.station || '').trim()
  const subsite = String(q.subsite || '').trim()
  const category = String(q.category || '').trim()
  const subcategory = String(q.subcategory || '').trim()
  const sort = String(q.sort || 'id')
  const order = String(q.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  const page = Math.max(1, parseInt(String(q.page || '1')) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(String(q.pageSize || '50')) || 50))
  const offset = (page - 1) * pageSize
  const includeSummary = String(q.includeSummary || '') === '1'

  const where: string[] = []
  const params: any[] = []
  if (!includeSummary) where.push('NOT is_summary')
  if (keyword) {
    where.push('(name LIKE ? OR brand_model LIKE ? OR remark LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (station) {
    where.push('station = ?')
    params.push(station)
  }
  if (subsite) {
    where.push('subsite = ?')
    params.push(subsite)
  }
  if (category) {
    where.push('category = ?')
    params.push(category)
  }
  if (subcategory) {
    where.push('subcategory = ?')
    params.push(subcategory)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const allowed: Record<string, string> = {
    id: 'id',
    name: 'name',
    station: 'station',
    unit_price: 'unit_price',
    total_price: 'total_price',
  }
  const sortCol = allowed[sort] || 'id'

  const total = Number(
    (await db.prepare(`SELECT COUNT(*) AS c FROM v_device_prices ${whereSql}`).get(...params) as { c: any }).c
  )
  const items = await db
    .prepare(
      `SELECT sd_id AS id, station, subsite, category, subcategory, name, unit, brand_model,
              qty, unit_price, total_price, remark, device_id, subsite_id
       FROM v_device_prices ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})
