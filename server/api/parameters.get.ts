import db from '../utils/db'

function safeParse(s: any): any {
  if (!s) return s
  if (typeof s !== 'string') return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

// 参数字典：按标准聚合，供 /parameters 页（标准卡片 + 左侧分类树 + 右侧明细表）
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const standardId = (q.standard_id as string) || ''
  const category = (q.category as string) || '' // 开发 / 运维

  const conds: string[] = []
  const params: any[] = []
  let i = 0
  if (standardId) {
    conds.push(`standard_id=$${++i}`)
    params.push(standardId)
  }
  if (category) {
    conds.push(`category=$${++i}`)
    params.push(category)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const rows = await db
    .prepare(
      `SELECT id, standard_id, standard_code, standard_name, edition, region, org, category,
              param_category, param_name, param_type, unit, values, description, seq
       FROM estimation_parameters ${where} ORDER BY standard_id, seq`
    )
    .all(...params)

  const list = (rows as any[]).map((r) => ({
    id: r.id,
    standardId: r.standard_id,
    standardCode: r.standard_code,
    standardName: r.standard_name,
    edition: r.edition,
    region: r.region,
    org: r.org,
    category: r.category,
    paramCategory: r.param_category,
    paramName: r.param_name,
    paramType: r.param_type,
    unit: r.unit,
    values: safeParse(r.values),
    description: r.description,
    seq: r.seq,
  }))

  return { parameters: list }
})
