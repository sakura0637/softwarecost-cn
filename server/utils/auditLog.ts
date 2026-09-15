import db from './db'
import { getTableConf } from '../config/dataTables'
import { entityTypeLabel } from './logOperation'
import {
  MODULE_LABELS, ACTION_LABELS, DISPLAY_CANDIDATES, BATCH_ENTITY_ID, HEAVY_PLACEHOLDER, isRevertibleEntity
} from '../config/audit'

// 审计日志查询（设备三表 + 数据维护全部表的共用实现）。
// 供 `/api/admin/operation-logs`（设备模块，devices:view）与 `/api/admin/logs`（全局审计，admin-logs:view）复用，
// 避免同一个查询写两份、改一处漏一处。

function parseChanges(v: any): any[] {
  try {
    const c = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(c) ? c : []
  } catch {
    return []
  }
}

/**
 * 实体友好名。
 * 数据维护的表：优先读**当前行**的显示列；行已删除时退回日志快照里的字段值。
 * 设备三表：走各自的关联查询（站点带管理处、对照带子站-设备）。
 */
async function entityDisplay(entityType: string, entityId: string | number, changes: any[]): Promise<string> {
  // 批量操作（如 Excel 导入）没有单一行实体，entity_id 存的是 'batch'
  if (String(entityId) === BATCH_ENTITY_ID) return '（批量操作）'

  const conf = getTableConf(entityType)
  if (conf) {
    const pk = conf.pk || 'id'
    try {
      const row = (await db.prepare(`SELECT * FROM "${entityType}" WHERE "${pk}"=?`).get(entityId)) as any
      if (row) {
        for (const c of DISPLAY_CANDIDATES) {
          if (row[c] != null && String(row[c]).trim()) return String(row[c])
        }
      }
    } catch { /* 表结构异常，退回快照 */ }
    for (const c of DISPLAY_CANDIDATES) {
      const hit = changes.find((ch) => ch?.field === c)
      const v = hit?.new ?? hit?.old
      if (v != null && String(v).trim()) return String(v)
    }
    return `#${entityId}`
  }

  try {
    if (entityType === 'station') {
      const s = (await db
        .prepare('SELECT s.name, p.name AS parent_name FROM stations s LEFT JOIN stations p ON s.parent_id = p.id WHERE s.id = ?')
        .get(entityId)) as any
      if (s) return `${s.parent_name ? s.parent_name + '/' : ''}${s.name}`
    } else if (entityType === 'device') {
      const d = (await db.prepare('SELECT category, name FROM devices WHERE id = ?').get(entityId)) as any
      if (d) return `${d.category || ''}/${d.name}`
    } else if (entityType === 'station_device') {
      const sd = (await db
        .prepare(
          'SELECT st.name AS subsite_name, d.name AS device_name, d.category AS device_category FROM station_devices sd JOIN stations st ON sd.subsite_id = st.id JOIN devices d ON sd.device_id = d.id WHERE sd.id = ?'
        )
        .get(entityId)) as any
      if (sd) return `${sd.subsite_name} - ${sd.device_category || ''}/${sd.device_name}`
    }
  } catch { /* 实体可能已删除，保留默认显示 */ }
  return `#${entityId}`
}

export interface AuditQuery {
  module?: string
  entityType?: string
  entityId?: number
  action?: string
  operator?: string
  page?: number
  pageSize?: number
}

export async function queryAuditLogs(q: AuditQuery) {
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(200, Math.max(5, Number(q.pageSize) || 30))

  const where: string[] = []
  const params: any[] = []
  if (q.module) { where.push('l.module = ?'); params.push(q.module) }
  if (q.entityType) { where.push('l.entity_type = ?'); params.push(q.entityType) }
  if (q.entityId) { where.push('l.entity_id = ?'); params.push(q.entityId) }
  if (q.action) { where.push('l.action = ?'); params.push(q.action) }
  if (q.operator) { where.push('l.operator_name ILIKE ?'); params.push(`%${q.operator}%`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = Number(
    ((await db.prepare(`SELECT COUNT(*) AS c FROM operation_logs ${whereSql.replace(/l\./g, '')}`).get(...params)) as any)?.c ?? 0
  )

  const rows = (await db
    .prepare(
      `SELECT l.id, l.module, l.entity_type, l.entity_id, l.action, l.operator_id, l.operator_name, l.changes, l.remark,
        to_char(l.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        EXISTS (
          SELECT 1 FROM operation_logs r
          WHERE r.action = 'revert'
            AND r.entity_type = l.entity_type
            AND r.entity_id = l.entity_id
            AND r.remark LIKE ('撤销 #' || l.id || ' 的%')
        ) AS reverted
       FROM operation_logs l
       ${whereSql}
       ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)) as any[]

  const items = await Promise.all(
    rows.map(async (r) => {
      const changes = parseChanges(r.changes)
      const name = await entityDisplay(r.entity_type, r.entity_id, changes)
      const typeLabel = entityTypeLabel(r.entity_type)
      return {
        id: r.id,
        module: r.module,
        moduleLabel: MODULE_LABELS[r.module] || r.module,
        entityType: r.entity_type,
        entityTypeLabel: typeLabel,
        entityId: r.entity_id,
        entityName: name.startsWith('#') ? `${typeLabel} ${name}` : name === '（批量操作）' ? `${typeLabel}${name}` : `${typeLabel} #${r.entity_id} ${name}`,
        action: r.action,
        actionLabel: ACTION_LABELS[r.action] || r.action,
        reverted: !!r.reverted,
        // 前端据此决定是否渲染撤销按钮，避免「点得动但必然报错」的死入口。
        // 三类不可撤销：① 实体本身不支持（附件）② 批量导入的汇总记录 ③ 快照里含大字段占位符
        // ——第③类如 standards 的 params/param_values 是 JSON 大字段，日志里只有占位文字，
        // 还原会把占位符写进 JSON 列，因此后端也会拦（见 utils/revertOperation.ts）。
        revertible:
          isRevertibleEntity(r.entity_type) &&
          String(r.entity_id) !== BATCH_ENTITY_ID &&
          !changes.some((c) => c?.old === HEAVY_PLACEHOLDER || c?.new === HEAVY_PLACEHOLDER),
        operatorId: r.operator_id,
        operatorName: r.operator_name,
        changes,
        remark: r.remark,
        createdAt: r.created_at,
      }
    })
  )

  return { total, page, pageSize, items }
}

/** 筛选项数据源：出现过的模块与实体类型（含中文名），供审计页下拉 */
export async function auditFacets() {
  const mods = (await db.prepare('SELECT DISTINCT module FROM operation_logs ORDER BY module').all()) as any[]
  const types = (await db
    .prepare('SELECT entity_type, COUNT(*)::int AS c FROM operation_logs GROUP BY entity_type ORDER BY c DESC')
    .all()) as any[]
  return {
    modules: mods.map((m) => ({ value: m.module, label: MODULE_LABELS[m.module] || m.module })),
    entityTypes: types.map((t) => ({ value: t.entity_type, label: entityTypeLabel(t.entity_type), count: Number(t.c) })),
  }
}
