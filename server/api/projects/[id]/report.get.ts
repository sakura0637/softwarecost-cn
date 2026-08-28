import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = user.role === 'admin'
    ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    : await db
        .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
        .get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const functionPoints = await db
    .prepare('SELECT * FROM function_points WHERE project_id = ? ORDER BY seq')
    .all(id)

  let result: any = null
  try {
    if (project.result_json) result = JSON.parse(project.result_json)
  } catch {
    result = null
  }

  return { project, functionPoints, result }
})
