// 数据维护：插入一行。POST → data:create
import { readBody } from 'h3'
import { insertRow, assertTable } from '../../../utils/adminData'

export default defineEventHandler(async (event) => {
  const table = (event as any).context.params?.table
  assertTable(table)
  const body = await readBody(event)
  const res = await insertRow(table, body)
  if (res.errors.length) throw createError({ statusCode: 400, statusMessage: res.errors.join('；') })
  return { id: res.id, ok: true }
})
