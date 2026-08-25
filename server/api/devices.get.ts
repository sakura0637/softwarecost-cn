import db from '../utils/db'
import { getQuery } from 'h3'

export default defineEventHandler((event) => {
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

  const where: string[] = []
  const params: any[] = []
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

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM device_prices ${whereSql}`).get(...params) as { c: number }).c
  const items = db
    .prepare(
      `SELECT id, station, subsite, category, name, unit, brand_model, qty, unit_price, total_price, remark
       FROM device_prices ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})
