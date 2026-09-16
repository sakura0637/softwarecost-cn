// 统一数据维护后端引擎：列内省 + 通用 CRUD + 类型校验 + 外键选项。
// 所有 /api/admin/data/* 路由共用；权限由 server/middleware/permission.ts 统一收口。
import db from './db'
import { createError } from 'h3'   // 与 server/utils/auth.ts 一致：显式导入，不依赖 Nuxt 自动导入
import { DATA_TABLES, DATA_CATEGORIES, getTableConf, labelFor, DataTableConf } from '../config/dataTables'
import { CALC_LABELS, isComputedCalc } from '../config/rowGroups'
import { logOperation } from './logOperation'

export interface ColumnMeta {
  name: string
  label: string
  dataType: string // 原始 PG 类型
  uiType: 'text' | 'number' | 'boolean' | 'date' | 'json'
  nullable: boolean
  readonly: boolean
  /** 列表不展示（编辑弹窗仍可维护）：公式这类对人不友好但需保留的字段 */
  hidden: boolean
  isPk: boolean
  pkAuto: boolean
  isFk: boolean
  fkTable?: string
  fkLabel?: string
}

function pgTypeToUi(t: string): ColumnMeta['uiType'] {
  const u = t.toLowerCase()
  if (/int|numeric|double|real|decimal|money/.test(u)) return 'number'
  if (u === 'boolean' || u === 'bool') return 'boolean'
  if (u.startsWith('date') || u.startsWith('timestamp')) return 'date'
  if (u === 'json' || u === 'jsonb') return 'json'
  return 'text'
}

// 校验表名在注册表内（防 SQL 注入：表名只取自配置，不取自用户输入）
export function assertTable(key: string): DataTableConf {
  const conf = getTableConf(key)
  if (!conf) throw createError({ statusCode: 404, statusMessage: `未注册的数据表：${key}` })
  return conf
}

// 运行时列内省（information_schema），并与配置合并出前端可用的列元数据
export async function getColumns(key: string): Promise<ColumnMeta[]> {
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const rows = await db
    .prepare(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=?
       ORDER BY ordinal_position`,
    )
    .all(key)
  const jsonSet = new Set(conf.json || [])
  const roSet = new Set(conf.readonly || [])
  const hidSet = new Set(conf.hidden || [])
  const fkMap = conf.fk || {}
  return rows.map((r: any) => {
    const name: string = r.column_name
    const isFk = !!fkMap[name]
    return {
      name,
      label: labelFor(key, name),
      dataType: r.data_type,
      uiType: jsonSet.has(name) ? 'json' : pgTypeToUi(r.data_type),
      nullable: r.is_nullable === 'YES',
      readonly: roSet.has(name) || (name === pk && !!conf.pkAuto),
      hidden: hidSet.has(name),
      isPk: name === pk,
      pkAuto: name === pk && !!conf.pkAuto,
      isFk,
      fkTable: fkMap[name]?.table,
      fkLabel: fkMap[name]?.label,
    }
  })
}

// 外键列的可选项（id + 显示列）
export async function getFkOptions(key: string, column: string): Promise<{ value: any; label: string }[]> {
  const conf = assertTable(key)
  const fk = conf.fk?.[column]
  if (!fk) return []
  const rows = await db.prepare(`SELECT id, "${fk.label}" AS label FROM "${fk.table}" ORDER BY id LIMIT 500`).all()
  return rows.map((r: any) => ({ value: r.id, label: String(r.label ?? r.id) }))
}

function coerce(value: any, col: ColumnMeta): any {
  if (value === '' || value === null || value === undefined) return null
  switch (col.uiType) {
    case 'number':
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        if (Number.isNaN(n)) throw new Error(`列「${col.label}」需为数字，收到：${value}`)
        return n
      }
      return null
    case 'boolean':
      return value === true || value === 'true' || value === 't' || value === '1' || value === 1
    case 'json':
      if (typeof value === 'object') return JSON.stringify(value)
      // TEXT 存储的 JSON：校验可解析
      try {
        JSON.parse(String(value))
      } catch {
        throw new Error(`列「${col.label}」不是合法 JSON：${String(value).slice(0, 40)}`)
      }
      return String(value)
    case 'date':
      return String(value)
    default:
      return String(value)
  }
}

// 从请求体抽取「可编辑列」并校验；返回 { cols, vals, errors }
function pickEditable(body: any, columns: ColumnMeta[], opts: { isUpdate: boolean; pk?: string }) {
  const pk = opts.pk || 'id'
  const cols: string[] = []
  const vals: any[] = []
  const errors: string[] = []
  for (const col of columns) {
    if (col.readonly) continue
    if (col.isPk && opts.isUpdate) continue // 更新时主键做 WHERE，不进 SET
    if (!(col.name in body)) continue
    let v: any
    try {
      v = coerce(body[col.name], col)
    } catch (e: any) {
      errors.push(e.message)
      continue
    }
    if (v === null && !col.nullable && !(col.isPk && !opts.isUpdate)) {
      // 自增主键在插入时允许为 null（由库生成）；其余 NOT NULL 必填
      if (!(col.isPk && !opts.isUpdate)) {
        errors.push(`列「${col.label}」为必填`)
        continue
      }
    }
    cols.push(col.name)
    vals.push(v)
  }
  return { cols, vals, errors }
}

export async function listRows(
  key: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ columns: ColumnMeta[]; rows: any[]; total: number; page: number; pageSize: number }> {
  const columns = await getColumns(key)
  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(500, Math.max(1, opts.pageSize || 50))
  const total = Number((await db.prepare(`SELECT COUNT(*)::int AS c FROM "${key}"`).get() as any).c)
  const rows = await db
    .prepare(`SELECT * FROM "${key}" ORDER BY id LIMIT ? OFFSET ?`)
    .all(pageSize, (page - 1) * pageSize)
  return { columns, rows, total, page, pageSize }
}

// ── 审计挂钩（2026-09-15）────────────────────────────────────────
// 增删改一律留痕：参数表是**覆盖式修改**的，改完之后没人知道「原来是多少」。
// 审计只在 dataTables 注册表内的表上生效（assertTable 已保证），且 event 缺省时不记录
// —— 让 Excel 导入等批量路径可以自行决定是否记账，而不是被动写出一堆噪声。
async function snapshotRow(key: string, pk: string, id: any): Promise<any | null> {
  try {
    return (await db.prepare(`SELECT * FROM "${key}" WHERE "${pk}"=?`).get(id)) as any
  } catch {
    return null
  }
}

// ── 「系统计算行」只读守卫（2026-09-16）────────────────────────────
// om_factors 里 calc='product'（分组合计）与 'weighted'（加权结果）的取值是引擎现算出来的：
//   · 引擎根本不读这两类行的存量值，改了完全不生效；
//   · 但界面上它长得和普通参数行一样，改完没反应会让人怀疑系统坏了，
//     更糟的是让人误以为「人员配备系数靠手改 0.905」而不知道要改那 5 个等级行。
// 所以直接拒绝改动它的关键字段，并在报错里说清「该去改哪一行」。
// 说明性字段（描述 / 取值依据 / 排序 / 启用）仍允许改，不挡正常维护。
const COMPUTED_FIELDS = ['name', 'value', 'calc', 'weight']

function sameValue(a: any, b: any): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a).trim() === String(b).trim()
}

/**
 * 若目标是系统计算行、且本次提交真的改动了关键字段 → 返回错误说明；否则返回 null。
 * 只在「值确实变了」时才拦，保证 导出→改→导入 的整表往返（结果行没动）依然能过。
 */
async function computedRowError(key: string, body: any, id?: any): Promise<string | null> {
  const columns = await getColumns(key)
  if (!columns.some((c) => c.name === 'calc')) return null // 该表没有「计算方式」概念
  const pk = assertTable(key).pk || 'id'
  const cur: any = id != null ? await snapshotRow(key, pk, id) : null
  const calc = String(body?.calc ?? cur?.calc ?? '')
  if (!isComputedCalc(calc)) return null
  const label = CALC_LABELS[calc] || calc
  if (!cur) {
    return `不能手工新增「${label}」行：「${body?.name || '(未填名称)'}」的取值由引擎现算，新建也不会生效。` +
      `请改为新增该分组的成员行（连乘项 / 加权项），结果行会自动出现。`
  }
  const changed = COMPUTED_FIELDS.filter((f) => f in (body || {}) && !sameValue(body[f], cur[f]))
  if (!changed.length) return null
  return `「${cur.name}」是系统计算行（${label}），取值由同组的成员行推导，` +
    `不接受直接修改${changed.length ? `（本次试图改：${changed.join('、')}）` : ''}。` +
    `请改该分组里参与计算的成员行，这一行会自动更新。`
}

export async function insertRow(key: string, body: any, event?: any): Promise<{ id?: any; errors: string[] }> {
  const columns = await getColumns(key)
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const { cols, vals, errors } = pickEditable(body, columns, { isUpdate: false, pk })
  if (errors.length) return { errors }
  const forbidden = await computedRowError(key, body)
  if (forbidden) return { errors: [forbidden] }
  if (!cols.length) return { errors: ['没有任何可写入的字段'] }
  const sql = `INSERT INTO "${key}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  const r = await db.prepare(sql).run(...vals)
  if (event && r.lastID != null) {
    await logOperation({
      event, module: 'admin/data', entityType: key, entityId: r.lastID, action: 'create',
      after: await snapshotRow(key, pk, r.lastID),
      remark: `新增 1 条（${conf.label}）`,
    })
  }
  return { id: r.lastID, errors: [] }
}

export async function updateRow(key: string, id: any, body: any, event?: any): Promise<{ changes: number; errors: string[] }> {
  const columns = await getColumns(key)
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const { cols, vals, errors } = pickEditable(body, columns, { isUpdate: true, pk })
  if (errors.length) return { changes: 0, errors }
  const forbidden = await computedRowError(key, body, id)
  if (forbidden) return { changes: 0, errors: [forbidden] }
  if (!cols.length) return { changes: 0, errors: [] }
  // 先取改前整行：改完就再也拿不到了（这是审计的关键，不能省）
  const before = event ? await snapshotRow(key, pk, id) : null
  const sql = `UPDATE "${key}" SET ${cols.map((c) => `"${c}"=?`).join(', ')} WHERE "${pk}"=?`
  const r = await db.prepare(sql).run(...vals, id)
  if (event && (r.changes ?? 0) > 0) {
    await logOperation({
      event, module: 'admin/data', entityType: key, entityId: id, action: 'update',
      before, after: await snapshotRow(key, pk, id),
      remark: `修改（${conf.label}）`,
    })
  }
  return { changes: r.changes ?? 0, errors: [] }
}

export async function deleteRow(key: string, id: any, event?: any): Promise<{ changes: number }> {
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const before = event ? await snapshotRow(key, pk, id) : null
  const cur = before ?? (await snapshotRow(key, pk, id))
  if (cur && isComputedCalc(cur.calc)) {
    throw createError({
      statusCode: 400,
      statusMessage: `「${cur.name}」是系统计算行（${CALC_LABELS[cur.calc] || cur.calc}），不能删除：` +
        `它由同组的成员行推导，删掉后测算仍会按公式现算，但界面会缺失这一行、无处核对。请改为修改该分组的成员行。`,
    })
  }
  const r = await db.prepare(`DELETE FROM "${key}" WHERE "${pk}"=?`).run(id)
  if (event && (r.changes ?? 0) > 0) {
    await logOperation({
      event, module: 'admin/data', entityType: key, entityId: Number(id), action: 'delete',
      before, remark: `删除（${conf.label}）`,
    })
  }
  return { changes: r.changes ?? 0 }
}

// 仅校验（不写库）：供 Excel 导入预览用。返回可编辑列与错误信息。
export async function validateBody(
  key: string,
  body: any,
  opts: { isUpdate: boolean; pk?: string },
): Promise<{ cols: string[]; vals: any[]; errors: string[] }> {
  const columns = await getColumns(key)
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  return pickEditable(body, columns, { isUpdate, pk })
}

// 给出当前表所有外键列的可选项（前端下拉用），随列表一起返回
export async function fkOptionsForTable(key: string): Promise<Record<string, { value: any; label: string }[]>> {
  const conf = assertTable(key)
  const out: Record<string, { value: any; label: string }[]> = {}
  if (conf.fk) {
    for (const col of Object.keys(conf.fk)) {
      out[col] = await getFkOptions(key, col)
    }
  }
  return out
}

// 注册表元信息（前端左树 + 编辑表单用）
export function registry() {
  return {
    categories: DATA_CATEGORIES,
    tables: DATA_TABLES,
  }
}
