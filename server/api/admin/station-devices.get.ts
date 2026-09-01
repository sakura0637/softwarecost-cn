import db from '../../utils/db'
import { getQuery } from 'h3'
import { requirePerm } from '../../utils/auth'

// 站点-设备对照列表（JOIN 出站点/设备名称便于展示）。合价由 qty×unit_price 现算。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:view')

  const q = getQuery(event)
  const subsiteId = q.subsite_id ? Number(q.subsite_id) : null
  const deviceId = q.device_id ? Number(q.device_id) : null
  const keyword = String(q.q || '').trim()
  const sort = String(q.sort || 'id')
  const order = String(q.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  const page = Math.max(1, parseInt(String(q.page || '1')) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(String(q.pageSize || '50')) || 50))
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: any[] = []
  if (subsiteId) { where.push('sd.subsite_id = ?'); params.push(subsiteId) }
  if (deviceId) { where.push('sd.device_id = ?'); params.push(deviceId) }
  if (keyword) { where.push('(d.name LIKE ? OR d.brand_model LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const allowed: Record<string, string> = { id: 'sd.id', qty: 'sd.qty', unit_price: 'd.unit_price', subsite: 's.name', device: 'd.name' }
  const sortCol = allowed[sort] || 'sd.id'

  const total = Number((await db.prepare(`SELECT COUNT(*) AS c FROM station_devices sd JOIN devices d ON d.id = sd.device_id ${whereSql}`).get(...params) as { c: any }).c)
  const items = await db
    .prepare(
      `SELECT sd.id, sd.subsite_id, sd.device_id, sd.qty, sd.remark, sd.source,
              s.name AS subsite, COALESCE(p.name, s.name) AS station,
              d.name AS device_name, d.category, d.subcategory, d.brand_model, d.unit, d.unit_price,
              (sd.qty * d.unit_price) AS total_price
       FROM station_devices sd
       JOIN devices d ON d.id = sd.device_id
       JOIN stations s ON s.id = sd.subsite_id
       LEFT JOIN stations p ON p.id = s.parent_id
       ${whereSql} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset)

  return { total, page, pageSize, items }
})
