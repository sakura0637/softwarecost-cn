import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'

// 角色列表（含每个角色已分配权限码），需 admin-roles:view
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-roles:view')
  const roles = db.prepare('SELECT id, code, name, description, is_system, created_at FROM roles ORDER BY id').all()
  const perms = db.prepare('SELECT role_id, permission_code FROM role_permissions').all() as { role_id: number; permission_code: string }[]
  const map: Record<number, string[]> = {}
  for (const p of perms) (map[p.role_id] ||= []).push(p.permission_code)
  return {
    roles: (roles as any[]).map(r => ({ ...r, permissions: map[r.id] || [] })),
  }
})
