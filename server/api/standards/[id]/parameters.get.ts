import db from '../../../utils/db'
import { getRouterParam } from 'h3'

// 列出某标准的全部参数明细（公开，作为标准的一部分展示）
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const rows = (await db
    .prepare(
      'SELECT id, param_category, param_name, param_type, unit, values, description, seq FROM standard_parameters WHERE standard_id = ? ORDER BY seq, id'
    )
    .all(id)) as any[]
  const parameters = rows.map((p) => ({
    id: p.id,
    paramCategory: p.param_category,
    paramName: p.param_name,
    paramType: p.param_type,
    unit: p.unit,
    values: (() => {
      if (p.values == null) return []
      if (typeof p.values !== 'string') return p.values
      try {
        return JSON.parse(p.values)
      } catch {
        return p.values
      }
    })(),
    description: p.description,
    seq: p.seq,
  }))
  return { parameters }
})
