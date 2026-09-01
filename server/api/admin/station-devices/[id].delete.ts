import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm } from '../../../utils/auth'
import { logOperation } from '../../../utils/logOperation'

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:delete')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const before = await db.prepare('SELECT * FROM station_devices WHERE id = ?').get(id)
  if (!before) throw createError({ statusCode: 404, statusMessage: '对照记录不存在' })

  await db.prepare('DELETE FROM station_devices WHERE id = ?').run(id)
  await logOperation({ event, entityType: 'station_device', entityId: id, action: 'delete', before })
  return { ok: true }
})
