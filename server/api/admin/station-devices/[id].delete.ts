import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:delete')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  await db.prepare('DELETE FROM station_devices WHERE id = ?').run(id)
  return { ok: true }
})
