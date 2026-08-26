import db from '../../utils/db'
import { getAuthUser } from '../../utils/auth'
import { createError, getRouterParam, readBody } from 'h3'

// 编辑标准（仅管理员）
export default defineEventHandler(async (event) => {
  const u = await getAuthUser(event)
  if (!u) throw createError({ statusCode: 401, statusMessage: '请先登录' })
  if (u.role !== 'admin') throw createError({ statusCode: 403, statusMessage: '仅管理员可管理标准' })
  const id = getRouterParam(event, 'id')!
  const b = await readBody(event)
  if (!db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id)) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  db.prepare(
    'UPDATE standards SET category=?, name=?, code=?, region=?, level=?, org=?, summary=?, params=?, param_values=? WHERE id=?'
  ).run(
    b.category || '', b.name, b.code || '', b.region || '', b.level || 'industry',
    b.org || '', b.summary || '', JSON.stringify(b.params || []), JSON.stringify(b.paramValues || {}), id
  )
  return { ok: true }
})
