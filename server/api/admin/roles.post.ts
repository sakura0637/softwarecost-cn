import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'
import { readBody, createError } from 'h3'

// 新建角色（需 admin-roles:create）。权限后续在角色编辑中分配
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-roles:create')
  const body = await readBody(event)
  const code = String(body.code || '').trim()
  const name = String(body.name || '').trim()
  const description = body.description ? String(body.description).trim() : null

  if (!code || !name) throw createError({ statusCode: 400, statusMessage: '角色编码和名称必填' })
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw createError({ statusCode: 400, statusMessage: '角色编码仅限字母/数字/下划线/中划线' })
  if (db.prepare('SELECT id FROM roles WHERE code = ?').get(code)) {
    throw createError({ statusCode: 409, statusMessage: '角色编码已存在' })
  }

  const info = db.prepare('INSERT INTO roles (code, name, description, is_system) VALUES (?, ?, ?, 0)').run(code, name, description)
  return { ok: true, id: Number(info.lastInsertRowid) }
})
