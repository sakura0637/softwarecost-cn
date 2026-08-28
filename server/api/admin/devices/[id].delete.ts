import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:delete')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const existing = await db.prepare('SELECT id FROM device_prices WHERE id = ?').get(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: '设备不存在' })

  await db.prepare('DELETE FROM device_prices WHERE id = ?').run(id)
  return { ok: true }
})
