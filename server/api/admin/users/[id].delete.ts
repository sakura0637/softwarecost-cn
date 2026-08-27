import db from '../../../utils/db'
import { requirePerm } from '../../../utils/auth'
import { createError, getRouterParam } from 'h3'

// 删除用户（需 admin-users:delete）。保护：不可删除最后一个管理员
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-users:delete')
  const id = Number(getRouterParam(event, 'id'))
  const exist = await db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!exist) throw createError({ statusCode: 404, statusMessage: '用户不存在' })

  const adminCount = Number((await db.prepare(`
    SELECT COUNT(*) AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = 'admin'
  `).get() as { c: any }).c)
  const selfIsAdmin = await db.prepare(`
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.code = 'admin'
  `).get(id)
  if (selfIsAdmin && adminCount <= 1) {
    throw createError({ statusCode: 400, statusMessage: '不能删除系统中唯一的管理员账号' })
  }

  await db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return { ok: true }
})
