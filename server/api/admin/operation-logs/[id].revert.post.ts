import db from '../../../utils/db'
import { createError } from 'h3'
import { requirePerm, getAuthUser } from '../../../utils/auth'

// 撤销一条操作记录：根据原 action 反向还原数据。
// - create → 删除该实体（有引用则 409 拒绝）
// - update → 用 changes 里的 old 值覆盖业务字段
// - delete → 用 changes 里的整行快照重新插入（保留原 id）
// 撤销本身写一条 action='revert' 的审计记录，避免循环依赖（不调用 logOperation 的整行快照逻辑）。

const TABLE_OF: Record<string, string> = {
  station: 'stations',
  device: 'devices',
  station_device: 'station_devices'
}
// 不允许通过撤销反向写入的系统字段
const SKIP_FIELDS = new Set(['id', 'created_at', 'updated_at'])

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  const id = Number(event.context.params!.id)
  if (!id || isNaN(id)) throw createError({ statusCode: 400, statusMessage: '无效 ID' })

  const log = await db.prepare('SELECT * FROM operation_logs WHERE id = ?').get(id) as any
  if (!log) throw createError({ statusCode: 404, statusMessage: '操作记录不存在' })

  const entityType: string = log.entity_type
  const entityId: number = log.entity_id
  const action: string = log.action

  if (!TABLE_OF[entityType]) throw createError({ statusCode: 400, statusMessage: '不支持的实体类型' })
  if (action === 'revert') throw createError({ statusCode: 400, statusMessage: '撤销操作不可再撤销' })

  let changes: any[] = []
  try { changes = typeof log.changes === 'string' ? JSON.parse(log.changes) : (log.changes || []) } catch { changes = [] }

  const table = TABLE_OF[entityType]

  if (action === 'create') {
    // 删除新建的实体（先查引用保护）
    if (entityType === 'device') {
      const ref = await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE device_id = ?').get(entityId) as any
      if (Number(ref.c) > 0) throw createError({ statusCode: 409, statusMessage: `该设备已被 ${ref.c} 条站点-设备对照引用，请先解除引用再撤销` })
      await db.prepare('DELETE FROM devices WHERE id = ?').run(entityId)
    } else if (entityType === 'station') {
      const child = await db.prepare('SELECT COUNT(*) AS c FROM stations WHERE parent_id = ?').get(entityId) as any
      const link = await db.prepare('SELECT COUNT(*) AS c FROM station_devices WHERE subsite_id = ?').get(entityId) as any
      if (Number(child.c) > 0 || Number(link.c) > 0) throw createError({ statusCode: 409, statusMessage: '该站点有子站或被站点-设备对照引用，无法删除' })
      await db.prepare('DELETE FROM stations WHERE id = ?').run(entityId)
    } else if (entityType === 'station_device') {
      await db.prepare('DELETE FROM station_devices WHERE id = ?').run(entityId)
    }
  } else if (action === 'update') {
    // 用 old 值还原业务字段
    const oldMap: Record<string, any> = {}
    for (const c of changes) {
      if (c && c.field && !SKIP_FIELDS.has(c.field)) oldMap[c.field] = c.old
    }
    const cols = Object.keys(oldMap)
    if (cols.length === 0) throw createError({ statusCode: 400, statusMessage: '该记录无业务字段可撤销' })
    const setters = cols.map((c) => `${c} = ?`).join(', ')
    const params = cols.map((c) => (oldMap[c] === undefined ? null : oldMap[c]))
    params.push(entityId)
    await db.prepare(`UPDATE ${table} SET ${setters}, updated_at = now() WHERE id = ?`).run(...params)
  } else if (action === 'delete') {
    // 用整行快照重新插入（保留原 id）
    const oldMap: Record<string, any> = {}
    for (const c of changes) {
      if (c && c.field && !SKIP_FIELDS.has(c.field)) oldMap[c.field] = c.old
    }
    const cols = Object.keys(oldMap)
    if (cols.length === 0) throw createError({ statusCode: 400, statusMessage: '该删除记录无快照可恢复' })

    if (entityType === 'device') {
      const dup = await db.prepare('SELECT id FROM devices WHERE name = ? AND category = ?').get(oldMap.name, oldMap.category) as any
      if (dup) throw createError({ statusCode: 409, statusMessage: '同名设备已存在，无法撤销删除（请手动新建）' })
    } else if (entityType === 'station') {
      if (oldMap.parent_id) {
        const p = await db.prepare('SELECT id FROM stations WHERE id = ?').get(oldMap.parent_id) as any
        if (!p) throw createError({ statusCode: 409, statusMessage: '原上级管理处已不存在，无法撤销删除' })
      }
    } else if (entityType === 'station_device') {
      const ref = await db.prepare('SELECT id FROM stations WHERE id = ? AND level = 2').get(oldMap.subsite_id) as any
      const dev = await db.prepare('SELECT id FROM devices WHERE id = ?').get(oldMap.device_id) as any
      if (!ref || !dev) throw createError({ statusCode: 409, statusMessage: '原子站或设备已不存在，无法撤销删除' })
    }

    const placeholders = cols.map(() => '?').join(', ')
    const params = cols.map((c) => (oldMap[c] === undefined ? null : oldMap[c]))
    await db.prepare(`INSERT INTO ${table} (id, ${cols.join(', ')}) VALUES (?, ${placeholders})`).run(entityId, ...params)
    // 把序列推进到 >= 当前最大 id，避免后续自增撞主键
    await db.prepare(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE(max(id),1), ?)) FROM ${table}`).run(entityId)
  }

  // 写撤销审计记录
  const u = await getAuthUser(event)
  let operatorName: string | null = null
  if (u) {
    const row = await db.prepare('SELECT username FROM users WHERE id = ?').get(u.id) as any
    operatorName = (row && row.username) || null
  }
  const ACTION_LABELS: Record<string, string> = { create: '新增', update: '修改', delete: '删除' }
  await db
    .prepare("INSERT INTO operation_logs (module, entity_type, entity_id, action, operator_id, operator_name, changes, remark, created_at) VALUES (?, ?, ?, 'revert', ?, ?, ?, ?, now())")
    .run('admin/devices', entityType, entityId, u ? u.id : null, operatorName, JSON.stringify([]), `撤销 #${id} 的${ACTION_LABELS[action] || action}操作`)

  return { ok: true }
})
