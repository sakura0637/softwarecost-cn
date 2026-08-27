import db from '../../../utils/db'
import { requirePerm } from '../../../utils/auth'
import { readBody, createError, getRouterParam } from 'h3'

// 编辑角色（名称/描述），需 admin-roles:edit
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-roles:edit')
  const id = Number(getRouterParam(event, 'id'))
  const r = await db.prepare('SELECT id FROM roles WHERE id = ?').get(id)
  if (!r) throw createError({ statusCode: 404, statusMessage: '角色不存在' })

  const body = await readBody(event)
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw createError({ statusCode: 400, statusMessage: '名称不可为空' })
    await db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(name, id)
  }
  if (body.description !== undefined) {
    const desc = body.description ? String(body.description).trim() : null
    await db.prepare('UPDATE roles SET description = ? WHERE id = ?').run(desc, id)
  }
  return { ok: true }
})
