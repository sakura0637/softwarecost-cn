import db from '../../../utils/db'
import { requirePerm } from '../../../utils/auth'
import { createError, getRouterParam } from 'h3'

// 删除角色（需 admin-roles:delete）。系统内置角色(admin/user)不可删；
// 删除后该角色与用户的关联、权限关联级联清除
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'admin-roles:delete')
  const id = Number(getRouterParam(event, 'id'))
  const r = db.prepare('SELECT id, is_system, code FROM roles WHERE id = ?').get(id) as { id: number; is_system: number; code: string } | undefined
  if (!r) throw createError({ statusCode: 404, statusMessage: '角色不存在' })
  if (r.is_system) throw createError({ statusCode: 400, statusMessage: '系统内置角色不可删除' })

  db.prepare('DELETE FROM roles WHERE id = ?').run(id)
  return { ok: true }
})
