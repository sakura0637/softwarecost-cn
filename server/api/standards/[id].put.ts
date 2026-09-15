import db from '../../utils/db'
import { requirePerm } from '../../utils/auth'
import { createError, getRouterParam, readBody } from 'h3'
import { logOperation } from '../../utils/logOperation'

// 编辑标准（需 standards:edit 权限）
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'standards:edit')
  const id = getRouterParam(event, 'id')!
  const b = await readBody(event)
  if (!(await db.prepare('SELECT 1 FROM standards WHERE id = ?').get(id))) {
    throw createError({ statusCode: 404, statusMessage: '标准不存在' })
  }
  // 改前整行先取下来 —— 改完就再也拿不到，这是审计还原字段的唯一依据
  const before = await db.prepare('SELECT * FROM standards WHERE id = ?').get(id)
  await db.prepare(
    'UPDATE standards SET category=?, name=?, code=?, region=?, level=?, org=?, summary=?, params=?, param_values=? WHERE id=?'
  ).run(
    b.category || '', b.name, b.code || '', b.region || '', b.level || 'industry',
    b.org || '', b.summary || '', JSON.stringify(b.params || []), JSON.stringify(b.paramValues || {}), id
  )
  await logOperation({
    event,
    module: 'standards',
    entityType: 'standards',
    entityId: id,
    action: 'update',
    before,
    after: await db.prepare('SELECT * FROM standards WHERE id = ?').get(id),
    remark: '编辑造价标准'
  })
  return { ok: true }
})
