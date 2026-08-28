import db from '../../utils/db'
import { getQuery, setHeader } from 'h3'
import * as XLSX from 'xlsx'

// 按当前筛选条件导出 Excel（不分页，返回全量）
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const keyword = String(q.q || '').trim()
  const station = String(q.station || '').trim()
  const subsite = String(q.subsite || '').trim()
  const category = String(q.category || '').trim()
  const subcategory = String(q.subcategory || '').trim()
  const sort = String(q.sort || 'id')
  const order = String(q.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC'

  const where: string[] = []
  const params: any[] = []
  if (keyword) {
    where.push('(name LIKE ? OR brand_model LIKE ? OR remark LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (station) {
    where.push('station = ?')
    params.push(station)
  }
  if (subsite) {
    where.push('subsite = ?')
    params.push(subsite)
  }
  if (category) {
    where.push('category = ?')
    params.push(category)
  }
  if (subcategory) {
    where.push('subcategory = ?')
    params.push(subcategory)
  }
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
      `SELECT id, station, subsite, category, subcategory, name, unit, brand_model, qty, unit_price, total_price, remark
       FROM device_prices ${whereSql} ORDER BY ${sortCol} ${order}`
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
