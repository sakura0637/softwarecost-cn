// 数据维护：导出某表为 xlsx。GET → data:view
import { setResponseHeader } from 'h3'
import * as XLSX from 'xlsx'
import db from '../../../../utils/db'
import { getColumns, assertTable } from '../../../../utils/adminData'

function fmt(v: any, uiType: string): any {
  if (v === null || v === undefined) return ''
  if (uiType === 'json') return typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (uiType === 'boolean') return v ? 'true' : 'false'
  return v
}

export default defineEventHandler(async (event) => {
  const table = (event as any).context.params?.table
  assertTable(table)
  const columns = await getColumns(table)
  const rows = await db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()
  const aoa: any[][] = [columns.map((c) => c.label)]
  for (const r of rows) aoa.push(columns.map((c) => fmt(r[c.name], c.uiType)))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'data')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${table}.xlsx"`)
  return new Uint8Array(buf as any)
})
