import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const body = await readBody(event)
  const station = String(body.station || '').trim()
  const subsite = body.subsite ? String(body.subsite).trim() : null
  const category = body.category ? String(body.category).trim() : null
  const subcategory = body.subcategory ? String(body.subcategory).trim() : null
  const name = String(body.name || '').trim()
  const unit = body.unit ? String(body.unit).trim() : null
  const brand_model = body.brand_model ? String(body.brand_model).trim() : null
  const qty = body.qty === '' || body.qty === null || body.qty === undefined ? null : Number(body.qty)
  const unit_price = body.unit_price === '' || body.unit_price === null || body.unit_price === undefined ? null : Number(body.unit_price)
  const total_price = body.total_price === '' || body.total_price === null || body.total_price === undefined ? null : Number(body.total_price)
  const remark = body.remark ? String(body.remark).trim() : null

  if (!station) throw createError({ statusCode: 400, statusMessage: '站点必填' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '设备名称必填' })

  const existing = await db.prepare('SELECT id FROM device_prices WHERE id = ?').get(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: '设备不存在' })

  await db
    .prepare(
      'UPDATE device_prices SET station = ?, subsite = ?, category = ?, subcategory = ?, name = ?, unit = ?, brand_model = ?, qty = ?, unit_price = ?, total_price = ?, remark = ? WHERE id = ?'
    )
    .run(station, subsite, category, subcategory, name, unit, brand_model, qty, unit_price, total_price, remark, id)

  return { ok: true, id }
})
