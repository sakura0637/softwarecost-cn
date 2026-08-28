import { defineEventHandler } from 'h3'
import { getQuery } from 'h3'
import db from '../utils/db'

// 行业/国标完整参数集（真实数据），驱动「行业基准数据」页
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const region = q.region as string | undefined
  const level = q.level as string | undefined
  const conds: string[] = []
  const params: any[] = []
  if (region) { conds.push(`region=$${params.length + 1}`); params.push(region) }
  if (level) { conds.push(`level=$${params.length + 1}`); params.push(level) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows: any[] = await db.prepare(
    `SELECT id, standard_code, standard_name, edition, region, level, org, category, ufp_method,
            ufp_weights, reuse_factors, cf, pdr, hm, rate, adjustment_factors, source
     FROM estimation_benchmarks ${where} ORDER BY level, region`
  ).all(...params)
  const list = rows.map((r: any) => ({
    id: r.id,
    standardCode: r.standard_code,
    standardName: r.standard_name,
    edition: r.edition,
    region: r.region,
    level: r.level,
    org: r.org,
    category: r.category,
    ufpMethod: r.ufp_method,
    ufpWeights: safeParse(r.ufp_weights),
    reuseFactors: safeParse(r.reuse_factors),
    cf: safeParse(r.cf),
    pdr: safeParse(r.pdr),
    hm: r.hm,
    rate: r.rate,
    adjustmentFactors: safeParse(r.adjustment_factors),
    source: r.source,
  }))
  return { benchmarks: list }
})

function safeParse(v: any) {
  if (v == null) return null
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } }
  return v
}
