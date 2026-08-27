import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'

// 权限目录（模块 → 按钮 树），需 admin-permissions:view
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-permissions:view')
  const perms = await db.prepare('SELECT code, name, type, module, parent, sort FROM permissions ORDER BY sort').all()
  return { permissions: perms }
})
