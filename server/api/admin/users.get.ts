import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'

// 用户列表（含角色名/编码），需 admin-users:view
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-users:view')
  const rows = await db.prepare(`
    SELECT u.id, u.username, u.email, u.phone, u.role, u.created_at,
           STRING_AGG(r.name, ',') AS role_names,
           STRING_AGG(r.code, ',') AS role_codes
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.id
  `).all()
  return { users: rows }
})
