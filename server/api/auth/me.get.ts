import db from '../../utils/db'
import { getUserId } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  const row = db
    .prepare('SELECT id, username, email, phone, created_at FROM users WHERE id = ?')
    .get(userId)
  if (!row) {
    throw createError({ statusCode: 401, statusMessage: '用户不存在' })
  }
  return { user: row }
})
