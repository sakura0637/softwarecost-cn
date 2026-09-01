import db from '../../utils/db'
import { getQuery } from 'h3'
import { requirePerm } from '../../utils/auth'

// 管理员设备主数据列表（devices 表）。单价是唯一价格源，合价不在此表。
// link_count 用于编辑时提示“改价将影响多少个子站”。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:view')

  const q = getQuery(event)
  const keyword = String(q.q || '').trim()
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
  if (category) { where.push('category = ?'); params.push(category) }
  if (subcategory) { where.push('subcategory = ?'); params.push(subcategory) }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const allowed: Record<string, string> = { id: 'id', name: 'name', unit_price: 'unit_price', category: 'category', updated_at: 'updated_at' }
  const sortCol = allowed[sort] || 'id'

  const total = Number((await db.prepare(`SELECT COUNT(*) AS c FROM devices ${whereSql}`).get(...params) as { c: any }).c)
  const items = await db
    .prepare(
      `SELECT id, category, subcategory, name, brand_model, unit, unit_price, remark, source, created_at, updated_at,
              (SELECT COUNT(*) FROM station_devices sd WHERE sd.device_id = devices.id) AS link_count
       FROM devices ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})
