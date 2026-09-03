// 数据维护：删除一行。DELETE → data:delete
import { deleteRow, assertTable } from '../../../../utils/adminData'

export default defineEventHandler(async (event) => {
  const params = (event as any).context.params
  assertTable(params.table)
  const res = await deleteRow(params.table, params.id)
  if (res.changes === 0) throw createError({ statusCode: 404, statusMessage: '未找到该记录' })
  return { changes: res.changes, ok: true }
})
