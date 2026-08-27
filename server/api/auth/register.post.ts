import db from '../../utils/db'
import { hashPassword, signToken, getUserPerms } from '../../utils/auth'
import { readBody, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const email = body.email ? String(body.email).trim() : null
  const phone = body.phone ? String(body.phone).trim() : null

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: '用户名和密码必填' })
  }
  if (password.length < 6) {
    throw createError({ statusCode: 400, statusMessage: '密码至少 6 位' })
  }
  if (username.length < 2) {
    throw createError({ statusCode: 400, statusMessage: '用户名至少 2 个字符' })
  }

  const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) {
    throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
  }

  const password_hash = await hashPassword(password)
  const info = await db
    .prepare('INSERT INTO users (username, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run(username, email, phone, password_hash, 'user')
  const userId = Number(info.lastID)
  // 新注册用户默认授予「普通用户」角色
  const userRoleId = (await db.prepare('SELECT id FROM roles WHERE code = ?').get('user') as { id: number } | undefined)
  if (userRoleId) await db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, userRoleId.id)
  const token = await signToken(String(userId), 'user')
  const perms = await getUserPerms(userId)

  return { token, user: { id: userId, username, email, phone, role: 'user', ...perms } }
})
