import db from '../../utils/db'
import { getAuthUser } from '../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = user.role === 'admin'
    ? await db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
    : await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  await db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return { ok: true }
})
