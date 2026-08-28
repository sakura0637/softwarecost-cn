import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { buildPricingStandards } from '../../../utils/pricingStandards'
import { derivePricing } from '../../../utils/pricing'
import { readBody, createError } from 'h3'

// 项目造价测算：参数全部来自数据库（不再使用任何硬编码示例单价）
// 可选项：
//   standardId —— 计价标准档位（14 套，见 /api/pricing-standards）
//   city       —— 城市费率覆盖（对 rateMode='city' 的行业基准标准必需，其余可选）
//   pdr        —— 生产率覆盖（可从标准的 pdrOptions 里选，如 P25/P50/P75）
//   vaf        —— 规模调整因子（0.5~1.5）
export default defineEventHandler(async (event) => {
  const user = await getAuthUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  const id = Number(event.context.params!.id)
  const project =
    user.role === 'admin'
      ? await db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
      : await db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.id)
  if (!project) throw createError({ statusCode: 404, statusMessage: '项目不存在' })

  const body = await readBody(event)
  const { standards, cities } = await buildPricingStandards()
  if (!standards.length) throw createError({ statusCode: 400, statusMessage: '无可用计价标准' })

  const standardId = body.standardId || body.standard || project.standard_id || ''
  const std =
    standards.find((s) => s.id === standardId) ||
    standards.find((s) => s.complete) ||
    standards.find((s) => s.usable) ||
    standards[0]
  if (!std) throw createError({ statusCode: 400, statusMessage: '无可用计价标准' })

  // —— 费率：标准自带优先，其次按城市覆盖 ——
  let rate = std.rate
  let rateSource = std.rateMode === 'standard' ? `${std.code} 标准给定` : ''
  const cityName = (body.city || '').trim()
  if (cityName) {
    const c = cities.find((x) => x.city === cityName)
    const cr = c ? (std.category === '运维' ? c.maintenance : c.development) : null
    if (cr) {
      rate = cr
      rateSource = `${cityName} 当年城市费率`
    }
  }
  if (rate == null) {
    throw createError({
      statusCode: 400,
      statusMessage: `标准「${std.name}」未给定人月费率，请在请求中指定 city（可选：${cities
        .slice(0, 8)
        .map((c) => c.city)
        .join('、')} 等 ${cities.length} 个城市）`,
    })
  }

  // —— 生产率：可覆盖（P25/P50/P75…）——
  // 标准本身没有生产率数据的方法类标准（如 GB/T 36964）不做兜底填充，
  // 此处必须拦住，否则会算出 NaN 或无意义的费用。
  const pdr = Number(body.pdr) > 0 ? Number(body.pdr) : std.pdr
  if (!pdr || !Number.isFinite(pdr)) {
    const pick = standards.filter((s) => s.usable).map((s) => s.name)
    throw createError({
      statusCode: 400,
      statusMessage:
        `标准「${std.name}」未给定基准生产率，无法测算。可改用：${pick.slice(0, 4).join('、')}`,
    })
  }
  const vaf = Math.max(0.5, Math.min(1.5, Number(body.vaf) || 1.0))

  const fps = (await db
    .prepare('SELECT * FROM function_points WHERE project_id = ?')
    .all(id)) as any[]
  const totalUFP = fps.reduce((s: number, fp: any) => s + (Number(fp.ufp) || 0), 0)
  const adjustedUFP = Math.round(totalUFP * vaf * 100) / 100

  const { productivity, fpPrice, laborRateWan, hoursPerFP } = derivePricing({
    hm: std.hm,
    rate,
    pdr,
  })
  const cost = Math.round(adjustedUFP * fpPrice)
  const months = productivity ? Math.round((adjustedUFP / productivity) * 100) / 100 : null

  const result = {
    standardId: std.id,
    standardName: std.name,
    standardCode: std.code,
    category: std.category,
    city: cityName || null,
    hm: std.hm,
    rate,
    rateSource: rateSource || (std.filled.find((f) => f.startsWith('rate')) ?? std.code),
    pdr,
    pdrLabel: std.pdrOptions.find((o) => o.value === pdr)?.label ?? null,
    productivity, // FP/人月
    hoursPerFP, // 人时/功能点
    fpPrice, // 元/功能点
    laborRateWan, // 万元/人月
    totalUFP,
    vaf,
    adjustedUFP,
    cost,
    months,
    currency: 'CNY',
    functionPointCount: fps.length,
    filled: std.filled, // 标注哪些参数是补齐的
    generatedAt: new Date().toISOString(),
  }

  await db
    .prepare(
      "UPDATE projects SET status = 'calculated', standard_id = ?, result_json = ?, updated_at = now() WHERE id = ?"
    )
    .run(std.id, JSON.stringify(result), id)

  return { result }
})
