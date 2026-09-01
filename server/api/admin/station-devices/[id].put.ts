import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const body = await readBody(event)
  const qty = body.qty === '' || body.qty === null || body.qty === undefined ? null : Number(body.qty)
  const remark = String(body.remark ?? '').trim() || null
  await db.prepare('UPDATE station_devices SET qty = ?, remark = ?, source = ?, updated_at = now() WHERE id = ?').run(qty, remark, 'manual', id)
  return { ok: true }
})
