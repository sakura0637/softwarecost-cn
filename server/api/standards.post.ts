import db from '../utils/db'
import { requirePerm } from '../utils/auth'
import { createError, readBody } from 'h3'

// 新增标准（需 standards:create 权限，系统管理员默认拥有）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:create')
  const b = await readBody(event)
  if (!b?.id || !b?.name) throw createError({ statusCode: 400, statusMessage: 'id 与 name 必填' })
  if (db.prepare('SELECT 1 FROM standards WHERE id = ?').get(b.id)) {
    throw createError({ statusCode: 409, statusMessage: '该 id 已存在' })
  }
  db.prepare(
    'INSERT INTO standards (id, category, name, code, region, level, org, summary, params, param_values) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    b.id, b.category || '', b.name, b.code || '', b.region || '', b.level || 'industry',
    b.org || '', b.summary || '', JSON.stringify(b.params || []), JSON.stringify(b.paramValues || {})
  )
  return { ok: true }
})
