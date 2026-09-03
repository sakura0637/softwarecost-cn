// 数据维护：更新一行。PUT → data:edit
import { readBody } from 'h3'
import { updateRow, assertTable } from '../../../../utils/adminData'

export default defineEventHandler(async (event) => {
  const params = (event as any).context.params
  assertTable(params.table)
  const body = await readBody(event)
  const res = await updateRow(params.table, params.id, body)
  if (res.errors.length) throw createError({ statusCode: 400, statusMessage: res.errors.join('；') })
  return { changes: res.changes, ok: true }
})
