// 数据维护：导入 xlsx（两步）。
//   第一步 apply=0：解析 + 校验，返回预览报告（不写库）
//   第二步 apply=1：按 mode(overwrite|incremental) 落库
// POST → data:create
//
// 【审计】批量导入是「一次操作改变上百行参数」的最大变更源，必须留痕。
// 逐行写日志会刷出上千条把审计页淹掉，所以这里每个批次只落 **一条汇总记录**：
//   谁、什么时候、用哪个文件、覆盖还是增量、导入前多少行 → 导入后多少行。
// 覆盖导入尤其要记 —— 它先 DELETE 整表，是全站最具破坏性的一个动作。
import { readMultipartFormData } from 'h3'
import * as XLSX from 'xlsx'
import db from '../../../../utils/db'
import { getColumns, assertTable, validateBody, insertRow, updateRow } from '../../../../utils/adminData'
// getTableConf 定义在 config/dataTables.ts，不在 utils/adminData.ts（Rollup 会报 MISSING_EXPORT）
import { getTableConf } from '../../../../config/dataTables'
import { logOperation } from '../../../../utils/logOperation'

async function countRows(table: string): Promise<number> {
  const r = (await db.prepare(`SELECT COUNT(*)::int AS c FROM "${table}"`).get()) as any
  return Number(r?.c ?? 0)
}

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
  const beforeCount = await countRows(table)

  // 批次审计的统一出口：无论走哪条分支，最后都记一条
  const logBatch = async (imported: number, logMode: string) => {
    const afterCount = await countRows(table)
    await logOperation({
      event,
      module: 'admin/data',
      entityType: table,
      entityId: 'batch',
      action: 'update',
      changes: [
        { field: '操作', label: '操作', old: null, new: logMode },
        { field: '文件', label: '文件', old: null, new: file.filename || '（未命名）' },
        { field: '影响行数', label: '影响行数', old: `${beforeCount} 条（导入前）`, new: `${imported} 条（导入后共 ${afterCount} 条）` }
      ],
      remark: `Excel 批量导入（${conf.label}）`
    })
  }

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
    await logBatch(rawRows.length, '覆盖导入（先清空整表再写入）')
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
  await logBatch(imported, '增量导入（按主键新增/更新）')
  return { mode, imported, skipped, ok: true }
})
