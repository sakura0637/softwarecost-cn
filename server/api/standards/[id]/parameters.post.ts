import db from '../../../utils/db'
import { requirePerm } from '../../../utils/auth'
import { createError, getRouterParam, readBody } from 'h3'
import { logOperation } from '../../../utils/logOperation'

// 新增某标准的参数明细（需 standards:edit 权限）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:edit')
  const id = getRouterParam(event, 'id')!
  const b = await readBody(event)
  if (!(await db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id))) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  if (!b?.param_name || !b.param_name.trim()) {
    throw createError({ statusCode: 400, statusMessage: '参数名必填' })
  }
  const valuesRaw = typeof b.values === 'string' ? b.values : JSON.stringify(b.values ?? [])
  const ins = await db
    .prepare(
      'INSERT INTO standard_parameters (standard_id, param_category, param_name, param_type, unit, values, description, seq) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(
      id,
      b.param_category || '',
      b.param_name.trim(),
      b.param_type || '',
      b.unit || '',
      valuesRaw,
      b.description || '',
      Number(b.seq) || 0
    )
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standard_parameters',
    entityId: ins.lastID,
    action: 'create',
    after: await db.prepare('SELECT * FROM standard_parameters WHERE id = ?').get(ins.lastID),
    remark: `新增标准参数明细（所属标准 ${id}）`
  })
  return { ok: true }
})
