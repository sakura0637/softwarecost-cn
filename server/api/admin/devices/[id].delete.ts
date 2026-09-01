import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm } from '../../../utils/auth'

// 删除设备主数据。被站点对照引用时拒绝（409，提示影响条数），避免产生孤儿对照。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:delete')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const existing = await db.prepare('SELECT id FROM devices WHERE id = ?').get(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: '设备不存在' })

  const links = Number((await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE device_id = ?').get(id) as { c: any }).c)
  if (links > 0) throw createError({ statusCode: 409, statusMessage: `该设备被 ${links} 条站点对照引用，无法删除（请先删除对应对照记录）` })

  await db.prepare('DELETE FROM devices WHERE id = ?').run(id)
  return { ok: true }
})
