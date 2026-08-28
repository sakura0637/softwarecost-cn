import db from '../../utils/db'
import { getAuthUser } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  // 管理员查看全部项目；普通用户只看自己名下
  const projects = user.role === 'admin'
    ? await db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
    : await db
        .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
        .all(user.id)
  return { projects }
})
