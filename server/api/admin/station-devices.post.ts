import db from '../../../utils/db'
import { readBody, createError } from 'h3'
import { requirePerm } from '../../../utils/auth'
import { logOperation } from '../../../utils/logOperation'

// 新增/更新站点-设备对照。subsite_id 与 device_id 必须来自已有基础表（后端二次校验）；
// 同一子站同一设备唯一，重复提交覆盖数量（不累加）。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const body = await readBody(event)
  const subsiteId = Number(body.subsite_id)
  const deviceId = Number(body.device_id)
  if (!subsiteId || !deviceId || isNaN(subsiteId) || isNaN(deviceId)) throw createError({ statusCode: 400, statusMessage: '子站与设备均为必选' })

  const s = await db.prepare('SELECT id FROM stations WHERE id = ? AND level = 2').get(subsiteId)
  if (!s) throw createError({ statusCode: 400, statusMessage: '子站不存在或不是子站节点' })
  const d = await db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId)
  if (!d) throw createError({ statusCode: 400, statusMessage: '设备不存在' })

  const qty = body.qty === '' || body.qty === null || body.qty === undefined ? null : Number(body.qty)
  const remark = String(body.remark || '').trim() || null

  const existing = await db.prepare('SELECT * FROM station_devices WHERE subsite_id = ? AND device_id = ?').get(subsiteId, deviceId)
  if (existing) {
    await db.prepare('UPDATE station_devices SET qty = ?, remark = ?, source = ?, updated_at = now() WHERE subsite_id = ? AND device_id = ?')
      .run(qty, remark, 'manual', subsiteId, deviceId)
    const after = await db.prepare('SELECT * FROM station_devices WHERE subsite_id = ? AND device_id = ?').get(subsiteId, deviceId)
    await logOperation({ event, entityType: 'station_device', entityId: Number(existing.id), action: 'update', before: existing, after })
    return { ok: true, id: Number(existing.id), updated: true }
  }
  const info = await db.prepare('INSERT INTO station_devices (subsite_id, device_id, qty, remark, source) VALUES (?, ?, ?, ?, ?)')
    .run(subsiteId, deviceId, qty, remark, 'manual')
  const newId = Number(info.lastID)
  const row = await db.prepare('SELECT * FROM station_devices WHERE id = ?').get(newId)
  await logOperation({ event, entityType: 'station_device', entityId: newId, action: 'create', after: row })
  return { ok: true, id: newId, updated: false }
})
