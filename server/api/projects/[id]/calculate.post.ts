import db from '../../../utils/db'
import { getUserId } from '../../../utils/auth'
import { PRICING } from '../../../utils/pricing'
import { readBody, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const userId = await getUserId(event)
  if (!userId) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(id, userId)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const body = await readBody(event)
  const standardId = body.standardId || project.standard_id || 'default'
  const vaf = Math.max(0.5, Math.min(1.5, Number(body.vaf) || 1.0))

  const fps = db.prepare('SELECT * FROM function_points WHERE project_id = ?').all(id)
  const totalUFP = fps.reduce((s: number, fp: any) => s + (fp.ufp || 0), 0)

  const std = body.standard || PRICING[standardId] || PRICING['default']
  const unitPrice = Number(std.unitPrice) || PRICING['default'].unitPrice
  const productivity = Number(std.productivity) || 0
  const name = std.name || standardId

  const adjustedUFP = Math.round(totalUFP * vaf * 100) / 100
  const cost = Math.round(adjustedUFP * unitPrice * 100) / 100
  const months = productivity ? Math.round((adjustedUFP / productivity) * 100) / 100 : null

  const result = {
    standardId,
    standardName: name,
    totalUFP,
    vaf,
    adjustedUFP,
    unitPrice,
    cost,
    months,
    currency: 'CNY',
    functionPointCount: fps.length,
    generatedAt: new Date().toISOString()
  }

  db.prepare(
    "UPDATE projects SET status = 'calculated', standard_id = ?, result_json = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(standardId, JSON.stringify(result), id)

  return { result }
})
