import db from '../../utils/db'
import { requirePerm, hashPassword } from '../../utils/auth'
import { readBody, createError } from 'h3'

// 新建用户（需 admin-users:create）。可同时分配多个角色
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-users:create')
  const body = await readBody(event)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const email = body.email ? String(body.email).trim() : null
  const phone = body.phone ? String(body.phone).trim() : null
  const roleCodes: string[] = Array.isArray(body.roleCodes)
    ? body.roleCodes
    : (body.role ? [String(body.role)] : ['user'])

  if (!username || !password) throw createError({ statusCode: 400, statusMessage: '用户名和密码必填' })
  if (password.length < 6) throw createError({ statusCode: 400, statusMessage: '密码至少 6 位' })
  if (username.length < 2) throw createError({ statusCode: 400, statusMessage: '用户名至少 2 个字符' })
  if (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
  }

  const ph = await hashPassword(password)
  const info = await db
    .prepare('INSERT INTO users (username, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(username, email, phone, ph, roleCodes.includes('admin') ? 'admin' : 'user')
  const uid = Number(info.lastID)

  const insUr = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?')
  for (const rc of roleCodes) await insUr.run(uid, rc)

  return { ok: true, id: uid }
})
