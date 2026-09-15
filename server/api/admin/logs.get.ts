import { getQuery } from 'h3'
import { requirePerm } from '../../utils/auth'
import { queryAuditLogs, auditFacets } from '../../utils/auditLog'

// 全局操作审计（只读）。
// 与 /api/admin/operation-logs（设备模块专用、devices:view）的区别：
//   本接口覆盖**全部模块** —— 数据维护的参数表增删改、Excel 批量导入、运维测算存档等，
//   并要求 admin-logs:view（该权限只在系统管理员角色里）。
//   ?facets=1 时只返回筛选项（模块 / 实体类型），供页面初始化下拉。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-logs:view')
  const q = getQuery(event)

  if (q.facets === '1') return { facets: await auditFacets() }

  return queryAuditLogs({
    module: typeof q.module === 'string' ? q.module : '',
    entityType: typeof q.entity_type === 'string' ? q.entity_type : '',
    entityId: q.entity_id ? Number(q.entity_id) : 0,
    action: typeof q.action === 'string' ? q.action : '',
    operator: typeof q.operator === 'string' ? q.operator : '',
    page: Number(q.page) || 1,
    pageSize: Number(q.page_size) || 30,
  })
})
