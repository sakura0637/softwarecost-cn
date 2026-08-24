import db from '../../utils/db'
import { getUserId } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return { ok: true }
})
