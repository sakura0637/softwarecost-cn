import db from '../../utils/db'
import { getQuery, setHeader } from 'h3'
import * as XLSX from 'xlsx'

// 设备价格库导出（按当前筛选条件导出全量，不分页）。
// 【2026-09-01】数据源由宽表 device_prices 改为范式化视图 v_device_prices：
//   - 合价由视图现算（qty × unit_price），不读取存储合价，与浏览页口径完全一致
//   - 默认排除 is_summary（各管理处「全站设备汇总」合计行），避免金额重复；传 includeSummary=1 可含汇总
// 【2026-09-01 多选增强】station / subsite / category / subcategory 均支持多选：
//   入参可为重复参数（station=A&station=B）或逗号分隔（station=A,B）；空数组则忽略该条件。

function toArray(v: any): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String).filter((s) => s !== '')
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function inClause(col: string, vals: string[], params: any[]): string {
  if (vals.length === 0) return ''
  const ph = vals.map(() => '?')
  for (const v of vals) params.push(v)
  return `${col} IN (${ph.join(',')})`
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const keyword = String(q.q || '').trim()
  const stations = toArray(q.station)
  const subsites = toArray(q.subsite)
  const categories = toArray(q.category)
  const subcategories = toArray(q.subcategory)
  const sort = String(q.sort || 'id')
  const order = String(q.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  const includeSummary = String(q.includeSummary || '') === '1'

  const where: string[] = []
  const params: any[] = []
  if (!includeSummary) where.push('NOT is_summary')
  if (keyword) {
    where.push('(name LIKE ? OR brand_model LIKE ? OR remark LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  const stIn = inClause('station', stations, params)
  if (stIn) where.push(stIn)
  const ssIn = inClause('subsite', subsites, params)
  if (ssIn) where.push(ssIn)
  const catIn = inClause('category', categories, params)
  if (catIn) where.push(catIn)
  const subIn = inClause('subcategory', subcategories, params)
  if (subIn) where.push(subIn)
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''

  const allowed: Record<string, string> = {
    id: 'id',
    name: 'name',
    station: 'station',
    unit_price: 'unit_price',
    total_price: 'total_price',
  }
  const sortCol = allowed[sort] || 'id'

  const rows = await db
    .prepare(
      `SELECT sd_id AS id, station, subsite, category, subcategory, name, unit, brand_model, qty, unit_price, total_price, remark
       FROM v_device_prices ${whereSql} ORDER BY ${sortCol} ${order}`
    )
    .all(...params) as any[]

  const data = rows.map((d: any) => ({
    '序号': d.id,
    '站点': d.station,
    '子站': d.subsite || '',
    '分类': d.category || '',
    '子分类': d.subcategory || '',
    '设备名称': d.name,
    '品牌型号': d.brand_model || '',
    '单位': d.unit || '',
    '数量': d.qty ?? '',
    '单价(元)': d.unit_price ?? '',
    '合价(元)': d.total_price ?? '',
    '备注': d.remark || '',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '设备价格库')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', `attachment; filename="device_prices.xlsx"; filename*=UTF-8''${encodeURIComponent('设备价格库.xlsx')}`)
  return buf
})
