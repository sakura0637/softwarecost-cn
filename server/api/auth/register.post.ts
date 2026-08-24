import db from '../../utils/db'
import { hashPassword, signToken } from '../../utils/auth'
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

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (exists) {
    throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
  }

  const password_hash = await hashPassword(password)
  const info = db
    .prepare('INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)')
    .run(username, email, phone, password_hash)
  const userId = Number(info.lastInsertRowid)
  const token = await signToken(String(userId))

  return { token, user: { id: userId, username, email, phone } }
})
