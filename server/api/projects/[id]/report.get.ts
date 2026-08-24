import db from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const functionPoints = db
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
