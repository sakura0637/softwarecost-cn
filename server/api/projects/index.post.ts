import db from '../../utils/db'
import { getUserId } from '../../utils/auth'
import { readBody, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const body = await readBody(event)
  const name = String(body.name || '').trim()
  const description = body.description ? String(body.description) : null
  const method = body.method === 'nesma' ? 'nesma' : 'ifpug'
  const standard_id = body.standard_id ? String(body.standard_id) : null

  if (!name) throw createError({ statusCode: 400, statusMessage: '项目名称必填' })

  const info = await db
    .prepare(
      'INSERT INTO projects (user_id, name, description, method, standard_id) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, name, description, method, standard_id)
  const id = Number(info.lastID)
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return { project }
})
