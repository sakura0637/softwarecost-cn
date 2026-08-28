import { defineEventHandler } from 'h3'
import { getQuery } from 'h3'
import db from '../utils/db'

// 省市计价对比（真实数据），驱动「省市计价数据」页
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const level = q.level as string | undefined
  const conds: string[] = []
  const params: any[] = []
  if (level) { conds.push(`level=$${params.length + 1}`); params.push(level) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows: any[] = await db.prepare(
    `SELECT id, region, level, function_point_price, productivity, labor_rate, hm, rate, cf, source, year
     FROM provincial_pricing ${where} ORDER BY labor_rate DESC`
  ).all(...params)
  const list = rows.map((r: any) => ({
    id: r.id,
    region: r.region,
    level: r.level,
    functionPointPrice: Number(r.function_point_price),
    productivity: Number(r.productivity),
    laborRate: Number(r.labor_rate),
    hm: Number(r.hm),
    rate: Number(r.rate),
    cf: Number(r.cf),
    source: r.source,
    year: r.year,
  }))
  return { pricing: list }
})
