import db from '../utils/db'

function safeParse(s: string | null, def: any) {
  if (!s) return def
  try {
    return JSON.parse(s)
  } catch {
    return def
  }
}

// 公开：返回全部造价标准（从 standards 表读取，运行时权威）
export default defineEventHandler(async () => {
  const rows = db
    .prepare(
      'SELECT id, category, name, code, region, level, org, summary, params, param_values FROM standards ORDER BY id'
    )
    .all() as any[]
  const standards = rows.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    code: r.code,
    region: r.region,
    level: r.level,
    org: r.org,
    summary: r.summary,
    params: safeParse(r.params, []),
    paramValues: safeParse(r.param_values, {}),
  }))
  return { standards }
})
