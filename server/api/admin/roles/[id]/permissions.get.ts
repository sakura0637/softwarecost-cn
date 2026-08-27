import db from '../../../../utils/db'
import { requirePerm } from '../../../../utils/auth'
import { getRouterParam } from 'h3'

// 某角色当前权限码列表，需 admin-permissions:view
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-permissions:view')
  const id = Number(getRouterParam(event, 'id'))
  const rows = await db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?').all(id) as { permission_code: string }[]
  return { permissions: rows.map(r => r.permission_code) }
})
