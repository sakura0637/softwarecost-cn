import db from '../../../utils/db'
import { requirePerm, hashPassword } from '../../../utils/auth'
import { readBody, createError, getRouterParam } from 'h3'

// 编辑用户：基本信息 / 重置密码 / 重新分配角色（需 admin-users:edit）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-users:edit')
  const id = Number(getRouterParam(event, 'id'))
  const exist = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
  if (!exist) throw createError({ statusCode: 404, statusMessage: '用户不存在' })

  const body = await readBody(event)

  // 重置密码
  if (body.password) {
    if (String(body.password).length < 6) throw createError({ statusCode: 400, statusMessage: '密码至少 6 位' })
    const ph = await hashPassword(String(body.password))
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(ph, id)
  }
  // 基本信息
  if (body.username !== undefined) {
    const uname = String(body.username).trim()
    if (uname.length < 2) throw createError({ statusCode: 400, statusMessage: '用户名至少 2 个字符' })
    if (db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(uname, id)) {
      throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(uname, id)
  }
  if (body.email !== undefined) {
    const em = body.email ? String(body.email).trim() : null
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(em, id)
  }
  if (body.phone !== undefined) {
    const ph = body.phone ? String(body.phone).trim() : null
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(ph, id)
  }

  // 角色（重新分配）
  if (Array.isArray(body.roleCodes)) {
    const placeholders = body.roleCodes.map(() => '?').join(',')
    const roleIds = db.prepare(`SELECT id FROM roles WHERE code IN (${placeholders})`).all(...body.roleCodes) as { id: number }[]
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id)
      const ins = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)')
      for (const r of roleIds) ins.run(id, r.id)
    })
    tx()
    const hasAdmin = body.roleCodes.includes('admin')
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(hasAdmin ? 'admin' : 'user', id)
  }

  return { ok: true }
})
