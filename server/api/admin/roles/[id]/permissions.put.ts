import db from '../../../../utils/db'
import { requirePerm } from '../../../../utils/auth'
import { readBody, createError, getRouterParam } from 'h3'

// 设置某角色的权限（全量覆盖），需 admin-permissions:edit
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-permissions:edit')
  const id = Number(getRouterParam(event, 'id'))
  const r = await db.prepare('SELECT id FROM roles WHERE id = ?').get(id)
  if (!r) throw createError({ statusCode: 404, statusMessage: '角色不存在' })

  const body = await readBody(event)
  const codes: string[] = Array.isArray(body.permissions) ? body.permissions : []
  // 仅接受权限目录中真实存在的码
  const valid = new Set((await db.prepare('SELECT code FROM permissions').all() as { code: string }[]).map(p => p.code))
  const clean = codes.filter((c: string) => valid.has(c))

  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id)
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    for (const c of clean) await ins.run(id, c)
  })
  await tx()
  return { ok: true }
})
