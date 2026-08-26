import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'
import { createError, getRouterParam, readBody } from 'h3'

// 编辑标准（需 standards:edit 权限）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:edit')
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
