import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'
import { logOperation } from '../../../utils/logOperation'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const before = await db.prepare('SELECT * FROM station_devices WHERE id = ?').get(id)
  if (!before) throw createError({ statusCode: 404, statusMessage: '对照记录不存在' })

  const body = await readBody(event)
  const qty = body.qty === '' || body.qty === null || body.qty === undefined ? null : Number(body.qty)
  const remark = String(body.remark ?? '').trim() || null
  await db.prepare('UPDATE station_devices SET qty = ?, remark = ?, source = ?, updated_at = now() WHERE id = ?').run(qty, remark, 'manual', id)
  const after = await db.prepare('SELECT * FROM station_devices WHERE id = ?').get(id)
  await logOperation({ event, entityType: 'station_device', entityId: id, action: 'update', before, after })
  return { ok: true }
})
