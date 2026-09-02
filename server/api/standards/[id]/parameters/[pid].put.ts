import db from '../../../../utils/db'
import { requirePerm } from '../../../../utils/auth'
import { createError, getRouterParam, readBody } from 'h3'

// 编辑某标准的单条参数明细（需 standards:edit 权限）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:edit')
  const id = getRouterParam(event, 'id')!
  const pid = Number(getRouterParam(event, 'pid'))
  const b = await readBody(event)
  if (!pid) throw createError({ statusCode: 400, statusMessage: '参数 id 缺失' })
  if (!(await db.prepare('SELECT 1 FROM standard_parameters WHERE id = ? AND standard_id = ?').get(pid, id))) {
    throw createError({ statusCode: 404, statusMessage: '参数不存在或不属于该标准' })
  }
  const valuesRaw = typeof b.values === 'string' ? b.values : JSON.stringify(b.values ?? [])
  await db
    .prepare(
      'UPDATE standard_parameters SET param_category=?, param_name=?, param_type=?, unit=?, values=?, description=?, seq=?, updated_at=now() WHERE id=? AND standard_id=?'
    )
    .run(
      b.param_category || '',
      b.param_name?.trim() || '',
      b.param_type || '',
      b.unit || '',
      valuesRaw,
      b.description || '',
      Number(b.seq) || 0,
      pid,
      id
    )
  return { ok: true }
})
