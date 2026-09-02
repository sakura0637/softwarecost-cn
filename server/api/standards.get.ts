import db from '../utils/db'

function safeParse(s: string | null, def: any) {
  if (!s) return def
  try {
    return JSON.parse(s)
  } catch {
    return def
  }
}

function parseValues(v: any) {
  if (v == null) return []
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

// 公开：返回全部造价标准（从 standards 表读取，运行时权威），并嵌套其参数明细（standard_parameters 从表）
export default defineEventHandler(async () => {
  const rows = (await db
    .prepare(
      'SELECT id, category, name, code, region, level, org, summary, params, param_values FROM standards ORDER BY id'
    )
    .all()) as any[]
  // 一次性拉取全部参数，按 standard_id 分组（避免 N+1）
  const paramRows = (await db
    .prepare(
      'SELECT id, standard_id, param_category, param_name, param_type, unit, values, description, seq FROM standard_parameters ORDER BY standard_id, seq, id'
    )
    .all()) as any[]
  const paramsByStd: Record<string, any[]> = {}
  for (const p of paramRows) {
    ;(paramsByStd[p.standard_id] ||= []).push({
      id: p.id,
      paramCategory: p.param_category,
      paramName: p.param_name,
      paramType: p.param_type,
      unit: p.unit,
      values: parseValues(p.values),
      description: p.description,
      seq: p.seq,
    })
  }
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
    parameters: paramsByStd[r.id] || [],
  }))
  return { standards }
})
