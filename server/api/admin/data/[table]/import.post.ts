// 数据维护：导入 xlsx（两步）。
//   第一步 apply=0：解析 + 校验，返回预览报告（不写库）
//   第二步 apply=1：按 mode(overwrite|incremental) 落库
// POST → data:create
import { readMultipartFormData } from 'h3'
import * as XLSX from 'xlsx'
import db from '../../../../utils/db'
import { getColumns, assertTable, validateBody, insertRow, updateRow } from '../../../../utils/adminData'
// getTableConf 定义在 config/dataTables.ts，不在 utils/adminData.ts（Rollup 会报 MISSING_EXPORT）
import { getTableConf } from '../../../../config/dataTables'

function rowExists(table: string, pk: string, id: any): Promise<boolean> {
  return db
    .prepare(`SELECT 1 FROM "${table}" WHERE "${pk}"=? LIMIT 1`)
    .get(id)
    .then((r: any) => !!r)
}

export default defineEventHandler(async (event) => {
  const table = (event as any).context.params?.table
  assertTable(table)
  const conf = getTableConf(table)!
  const pk = conf.pk || 'id'

  const form = await readMultipartFormData(event)
  const file = form.find((f) => f.filename)
  if (!file) throw createError({ statusCode: 400, statusMessage: '未收到 Excel 文件' })
  const mode = (form.find((f) => f.name === 'mode')?.data.toString() || 'incremental') as 'overwrite' | 'incremental'
  const apply = form.find((f) => f.name === 'apply')?.data.toString() === '1'

  const wb = XLSX.read(file.data, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const columns = await getColumns(table)
  const labelToCol: Record<string, string> = {}
  for (const c of columns) labelToCol[c.label] = c.name

  // 把表头标签映射回列名
  const toBody = (raw: Record<string, any>) => {
    const body: Record<string, any> = {}
    for (const [label, val] of Object.entries(raw)) {
      const col = labelToCol[label]
      if (col) body[col] = val
    }
    return body
  }

  // ── 第一步：预览校验（不写库）──
  if (!apply) {
    const errors: { row: number; msg: string }[] = []
    let valid = 0
    for (let i = 0; i < rawRows.length; i++) {
      const body = toBody(rawRows[i])
      const pkVal = body[pk]
      const isUpdate = pkVal !== '' && pkVal !== null && pkVal !== undefined
      const v = await validateBody(table, body, { isUpdate, pk })
      if (v.errors.length) errors.push({ row: i + 2, msg: v.errors.join('；') })
      else valid++
    }
    return { mode, total: rawRows.length, valid, invalid: rawRows.length - valid, errors: errors.slice(0, 50) }
  }

  // ── 第二步：落库 ──
  if (mode === 'overwrite') {
    await db.transaction(async () => {
      for (const dep of conf.overwriteCascade || []) {
        await db.prepare(`DELETE FROM "${dep}"`).run()
      }
      await db.prepare(`DELETE FROM "${table}"`).run()
      for (const raw of rawRows) {
        const body = toBody(raw)
        if (conf.pkAuto && (body[pk] === '' || body[pk] == null)) delete body[pk]
        const res = await insertRow(table, body)
        if (res.errors.length) throw createError({ statusCode: 400, statusMessage: `第 ${rawRows.indexOf(raw) + 2} 行：${res.errors.join('；')}` })
      }
    })
    return { mode, imported: rawRows.length, skipped: 0, ok: true }
  }

  // incremental：按主键存在与否 更新/插入
  let imported = 0
  let skipped = 0
  const errs: string[] = []
  for (let i = 0; i < rawRows.length; i++) {
    const body = toBody(rawRows[i])
    const pkVal = body[pk]
    const exists = pkVal !== '' && pkVal !== null && pkVal !== undefined && (await rowExists(table, pk, pkVal))
    if (exists) {
      const res = await updateRow(table, pkVal, body)
      if (res.errors.length) errs.push(`第 ${i + 2} 行：${res.errors.join('；')}`)
      else imported++
    } else {
      if (conf.pkAuto && (body[pk] === '' || body[pk] == null)) delete body[pk]
      const res = await insertRow(table, body)
      if (res.errors.length) errs.push(`第 ${i + 2} 行：${res.errors.join('；')}`)
      else imported++
    }
  }
  if (errs.length) throw createError({ statusCode: 400, statusMessage: errs.slice(0, 10).join('；') })
  return { mode, imported, skipped, ok: true }
})
