import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm } from '../../../utils/auth'
import { logOperation } from '../../../utils/logOperation'

// 删除站点/子站。有子站或被子站对照引用时拒绝（409 提示影响条数）。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:delete')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const before = await db.prepare('SELECT * FROM stations WHERE id = ?').get(id)
  if (!before) throw createError({ statusCode: 404, statusMessage: '站点不存在' })

  const child = Number((await db.prepare('SELECT COUNT(*) AS c FROM stations WHERE parent_id = ?').get(id) as { c: any }).c)
  if (child > 0) throw createError({ statusCode: 409, statusMessage: `该站点下还有 ${child} 个子站，无法删除（请先删除子站）` })

  const links = Number((await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE subsite_id = ?').get(id) as { c: any }).c)
  if (links > 0) throw createError({ statusCode: 409, statusMessage: `该站点被 ${links} 条设备对照引用，无法删除（请先删除对照）` })

  await db.prepare('DELETE FROM stations WHERE id = ?').run(id)
  await logOperation({ event, entityType: 'station', entityId: id, action: 'delete', before })
  return { ok: true }
})
