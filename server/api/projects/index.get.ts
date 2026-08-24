import db from '../../utils/db'
import { getUserId } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const projects = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
  return { projects }
})
