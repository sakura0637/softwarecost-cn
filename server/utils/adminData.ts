// 统一数据维护后端引擎：列内省 + 通用 CRUD + 类型校验 + 外键选项。
// 所有 /api/admin/data/* 路由共用；权限由 server/middleware/permission.ts 统一收口。
import { db } from './db'
import { DATA_TABLES, DATA_CATEGORIES, getTableConf, labelFor, DataTableConf } from '../config/dataTables'

export interface ColumnMeta {
  name: string
  label: string
  dataType: string // 原始 PG 类型
  uiType: 'text' | 'number' | 'boolean' | 'date' | 'json'
  nullable: boolean
  readonly: boolean
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

export async function insertRow(key: string, body: any): Promise<{ id?: any; errors: string[] }> {
  const columns = await getColumns(key)
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const { cols, vals, errors } = pickEditable(body, columns, { isUpdate: false, pk })
  if (errors.length) return { errors }
  if (!cols.length) return { errors: ['没有任何可写入的字段'] }
  const sql = `INSERT INTO "${key}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  const r = await db.prepare(sql).run(...vals)
  return { id: r.lastID, errors: [] }
}

export async function updateRow(key: string, id: any, body: any): Promise<{ changes: number; errors: string[] }> {
  const columns = await getColumns(key)
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const { cols, vals, errors } = pickEditable(body, columns, { isUpdate: true, pk })
  if (errors.length) return { changes: 0, errors }
  if (!cols.length) return { changes: 0, errors: [] }
  const sql = `UPDATE "${key}" SET ${cols.map((c) => `"${c}"=?`).join(', ')} WHERE "${pk}"=?`
  const r = await db.prepare(sql).run(...vals, id)
  return { changes: r.changes ?? 0, errors: [] }
}

export async function deleteRow(key: string, id: any): Promise<{ changes: number }> {
  const conf = assertTable(key)
  const pk = conf.pk || 'id'
  const r = await db.prepare(`DELETE FROM "${key}" WHERE "${pk}"=?`).run(id)
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
