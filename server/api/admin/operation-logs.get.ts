import { getQuery } from 'h3'
import { requirePerm } from '../../utils/auth'
import { queryAuditLogs } from '../../utils/auditLog'

// 设备模块的操作记录（站点 / 设备 / 站点-设备对照）。
// 全局审计（含参数表变更）在 /api/admin/logs —— 那里要求 logs:view，本接口维持 devices:view 不变，
// 以免改动既有页面（admin/devices.vue）的权限口径。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:view')
  const q = getQuery(event)
  return queryAuditLogs({
    entityType: typeof q.entity_type === 'string' && q.entity_type ? q.entity_type : 'device',
    entityId: typeof q.entity_id === 'string' && q.entity_id ? Number(q.entity_id) : 0,
    action: typeof q.action === 'string' && q.action ? q.action : '',
    page: Number(q.page) || 1,
    pageSize: 30,
  })
})
