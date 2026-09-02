import db from '../../../../utils/db'
import { requirePerm } from '../../../../utils/auth'
import { createError, getRouterParam } from 'h3'

// 删除某标准的单条参数明细（需 standards:edit 权限）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:edit')
  const id = getRouterParam(event, 'id')!
  const pid = Number(getRouterParam(event, 'pid'))
  if (!pid) throw createError({ statusCode: 400, statusMessage: '参数 id 缺失' })
  const r = await db
    .prepare('DELETE FROM standard_parameters WHERE id = ? AND standard_id = ?')
    .run(pid, id)
  if ((r as any).changes === 0) {
    throw createError({ statusCode: 404, statusMessage: '参数不存在或不属于该标准' })
  }
  return { ok: true }
})
