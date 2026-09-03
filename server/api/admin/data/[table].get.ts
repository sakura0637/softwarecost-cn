// 数据维护：列出某表数据（分页）+ 列元数据 + 外键下拉项。GET → data:view
import { getQuery } from 'h3'
import { listRows, fkOptionsForTable, assertTable } from '../../../utils/adminData'

export default defineEventHandler(async (event) => {
  const table = (event as any).context.params?.table
  assertTable(table)
  const q = getQuery(event)
  const page = Number(q.page) || 1
  const pageSize = Number(q.pageSize) || 50
  const data = await listRows(table, { page, pageSize })
  data.fkOptions = await fkOptionsForTable(table)
  return data
})
