import db from '../../utils/db'
import { getAuthUserWithPerms } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const au = await getAuthUserWithPerms(event)
  if (!au) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  const row = await db
    .prepare('SELECT id, username, email, phone, role, created_at FROM users WHERE id = ?')
    .get(au.id)
  if (!row) {
    throw createError({ statusCode: 401, statusMessage: '用户不存在' })
  }
  return {
    user: {
      ...row,
      roles: au.roles,
      permissions: au.permissions,
      isAdmin: au.isAdmin,
    },
  }
})
