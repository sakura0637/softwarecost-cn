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
  delete: '删除'
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

  const items = rows.map((r) => {
    let changes: any[] = []
    try { changes = typeof r.changes === 'string' ? JSON.parse(r.changes) : (r.changes || []) } catch { changes = [] }
    return {
      id: r.id,
      entityType: r.entity_type,
      entityTypeLabel: ENTITY_LABELS[r.entity_type] || r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actionLabel: ACTION_LABELS[r.action] || r.action,
      operatorId: r.operator_id,
      operatorName: r.operator_name,
      changes,
      remark: r.remark,
      createdAt: r.created_at
    }
  })

  return { total, page, pageSize, items }
})
