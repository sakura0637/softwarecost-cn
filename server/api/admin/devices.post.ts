import db from '../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../utils/auth'

// 新增设备主数据（devices 表）。source='manual' 标记页面手填，不被种子导入覆盖。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:create')

  const body = await readBody(event)
  const name = String(body.name || '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: '设备名称为必填' })

  const info = await db
    .prepare('INSERT INTO devices (category, subcategory, name, brand_model, unit, unit_price, remark, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      String(body.category || '').trim() || null,
      String(body.subcategory || '').trim() || null,
      name,
      String(body.brand_model || '').trim() || null,
      String(body.unit || '').trim() || null,
      body.unit_price === '' || body.unit_price === null || body.unit_price === undefined ? null : Number(body.unit_price),
      String(body.remark || '').trim() || null,
      'manual'
    )

  return { ok: true, id: Number(info.lastID) }
})
