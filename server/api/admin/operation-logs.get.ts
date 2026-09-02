import db from '../../utils/db'
import { createError, getQuery } from 'h3'
import { requirePerm } from '../../utils/auth'

// 操作记录列表。支持按 entity_type / entity_id / action 过滤，倒序分页。
const ENTITY_LABELS: Record<string, string> = {
  station: '站点',
  device: '设备',
  station_device: '站点-设备对照'
}
const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  revert: '撤销'
}

export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:view')

  const q = getQuery(event)
  const entityType = typeof q.entity_type === 'string' && q.entity_type ? q.entity_type : ''
  const entityId = typeof q.entity_id === 'string' && q.entity_id ? Number(q.entity_id) : 0
  const action = typeof q.action === 'string' && q.action ? q.action : ''
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = 30

  const where: string[] = []
  const params: any[] = []
  if (entityType) { where.push('entity_type = ?'); params.push(entityType) }
  if (entityId) { where.push('entity_id = ?'); params.push(entityId) }
  if (action) { where.push('action = ?'); params.push(action) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = Number((await db.prepare(`SELECT COUNT(*) AS c FROM operation_logs ${whereSql}`).get(...params) as { c: any }).c)
  const rows = (await db
    .prepare(`SELECT id, module, entity_type, entity_id, action, operator_id, operator_name, changes, remark, to_char(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS created_at FROM operation_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)) as any[]

  const items = await Promise.all(rows.map(async (r) => {
    let changes: any[] = []
    try { changes = typeof r.changes === 'string' ? JSON.parse(r.changes) : (r.changes || []) } catch { changes = [] }

    // 实体友好名称：站点带管理处、设备带分类、对照带子站-设备（含分类）
    let entityName = `${ENTITY_LABELS[r.entity_type] || r.entity_type} #${r.entity_id}`
    try {
      if (r.entity_type === 'station') {
        const s = await db.prepare('SELECT s.name, p.name AS parent_name FROM stations s LEFT JOIN stations p ON s.parent_id = p.id WHERE s.id = ?').get(r.entity_id) as any
        if (s) entityName = `站点 #${r.entity_id} ${s.parent_name ? s.parent_name + '/' : ''}${s.name}`
      } else if (r.entity_type === 'device') {
        const d = await db.prepare('SELECT category, name FROM devices WHERE id = ?').get(r.entity_id) as any
        if (d) entityName = `设备 #${r.entity_id} ${d.category || ''}/${d.name}`
      } else if (r.entity_type === 'station_device') {
        const sd = await db.prepare('SELECT st.name AS subsite_name, d.name AS device_name, d.category AS device_category FROM station_devices sd JOIN stations st ON sd.subsite_id = st.id JOIN devices d ON sd.device_id = d.id WHERE sd.id = ?').get(r.entity_id) as any
        if (sd) entityName = `站点-设备对照 #${r.entity_id} ${sd.subsite_name} - ${sd.device_category || ''}/${sd.device_name}`
      }
    } catch { /* 实体可能已删除，保留默认 id 显示 */ }

    return {
      id: r.id,
      entityType: r.entity_type,
      entityTypeLabel: ENTITY_LABELS[r.entity_type] || r.entity_type,
      entityId: r.entity_id,
      entityName,
      action: r.action,
      actionLabel: ACTION_LABELS[r.action] || r.action,
      operatorId: r.operator_id,
      operatorName: r.operator_name,
      changes,
      remark: r.remark,
      createdAt: r.created_at
    }
  }))

  return { total, page, pageSize, items }
})
