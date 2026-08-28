import db from '../utils/db'

// 城市费率时序：供 /city 页折线图 + 数据表
// 支持 ?rate_type=development|maintenance&year=2025&org=CSBMK|CSBSG 过滤
// 单位：元/人月
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const rateType = (q.rate_type as string) || ''
  const year = (q.year as string) || ''
  const org = (q.org as string) || ''

  const conds: string[] = []
  const params: any[] = []
  let i = 0
  if (rateType) {
    conds.push(`rate_type=$${++i}`)
    params.push(rateType)
  }
  if (year) {
    conds.push(`year=$${++i}`)
    params.push(Number(year))
  }
  if (org) {
    conds.push(`benchmark_org=$${++i}`)
    params.push(org)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = await db
    .prepare(
      `SELECT city, city_level, year, rate_type, rate, benchmark_org, source
       FROM city_rates ${where} ORDER BY year, city`
    )
    .all(...params)

  return {
    rates: (rows as any[]).map((r) => ({
      city: r.city,
      cityLevel: r.city_level,
      year: r.year,
      rateType: r.rate_type,
      rate: Number(r.rate), // 元/人月
      org: r.benchmark_org,
      source: r.source,
    })),
  }
})
