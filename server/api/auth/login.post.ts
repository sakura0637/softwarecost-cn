import db from '../../utils/db'
import { verifyPassword, signToken, getUserPerms } from '../../utils/auth'
import { readBody, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })
  }

  const token = await signToken(String(row.id), row.role)
  const perms = getUserPerms(row.id)
  return {
    token,
    user: { id: row.id, username: row.username, email: row.email, phone: row.phone, role: row.role, ...perms }
  }
})
