import db from '../../../utils/db'
import { getAuthUser } from '../../../utils/auth'
import { buildPricingStandards } from '../../../utils/pricingStandards'
import { runPricingEngine, nonFunctionalFactor, type FactorInput } from '@/shared/pricingEngine'
import { readBody, createError } from 'h3'

// 项目造价测算 —— GB/T 36964 完整链路
//   UFP → US(复用) → S(规模变更) → UE(工作量) → AE(SWF×RDF) → 人月 → 费用
//
// 可选项：
//   standardId —— 计价标准档位（见 /api/pricing-standards）
//   city       —— 城市费率覆盖（rateMode='city' 的标准必需，其余可选）
//   pdr        —— 基准生产率覆盖（可从标准的 pdrOptions 里选 P25/P50/P75）
//   cf / reuse / appType / platform / team / integrityLevel / nfSum / teamSize —— 各项调整因子
//     缺省均取中性值 1（不调整）。nfSum 为「性能+兼容+可靠+可移植」四项之和（每项 ±1，范围 -4~4）。

function numOrUndef(v: any): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

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
      statusMessage: `标准「${std.name}」未给定人月费率，请指定 city（可选：${cities.slice(0, 8).map((c) => c.city).join('、')} 等 ${cities.length} 个城市）`,
    })
  }

  // —— 生产率：可覆盖（P25/P50/P75…）；标准本身无生产率则直接拒绝，避免算出无意义结果 ——
  const pdr = numOrUndef(body.pdr) ?? std.pdr
  if (!pdr || !Number.isFinite(pdr)) {
    const pick = standards.filter((s) => s.usable).map((s) => s.name)
    throw createError({
      statusCode: 400,
      statusMessage: `标准「${std.name}」未给定基准生产率，无法测算。可改用：${pick.slice(0, 4).join('、')}`,
    })
  }

  const factors: FactorInput = {
    cf: numOrUndef(body.cf),
    reuse: numOrUndef(body.reuse),
    appType: numOrUndef(body.appType),
    platform: numOrUndef(body.platform),
    team: numOrUndef(body.team),
    integrityLevel: numOrUndef(body.integrityLevel),
    nfSum: numOrUndef(body.nfSum),
    teamSize: numOrUndef(body.teamSize),
  }

  const fps = (await db.prepare('SELECT * FROM function_points WHERE project_id = ?').all(id)) as any[]
  const totalUFP = fps.reduce((s: number, fp: any) => s + (Number(fp.ufp) || 0), 0)

  const r = runPricingEngine({ totalUFP, pdr, hm: std.hm, rate, factors })

  const result = {
    standardId: std.id,
    standardName: std.name,
    standardCode: std.code,
    category: std.category,
    city: cityName || null,
    hm: std.hm,
    rate,
    rateSource: rateSource || std.filled.find((f) => f.startsWith('rate')) || std.code,
    pdr,
    pdrLabel: std.pdrOptions.find((o) => o.value === pdr)?.label ?? null,
    // 完整计算链
    ufp: r.ufp,
    us: r.us,
    s: r.s,
    ue: r.ue,
    swf: r.swf,
    rdf: r.rdf,
    ae: r.ae,
    workMonths: r.workMonths,
    durationMonths: r.durationMonths,
    fpPrice: r.fpPrice,
    steps: r.steps,
    // 采用的因子（便于回溯）
    factors: {
      cf: factors.cf ?? 1,
      reuse: factors.reuse ?? 1,
      appType: factors.appType ?? 1,
      platform: factors.platform ?? 1,
      team: factors.team ?? 1,
      integrityLevel: factors.integrityLevel ?? 1,
      nfSum: factors.nfSum ?? null,
      nfFactor: factors.nfSum != null ? nonFunctionalFactor(factors.nfSum) : null,
      teamSize: factors.teamSize ?? null,
    },
    cost: r.cost,
    currency: 'CNY',
    functionPointCount: fps.length,
    filled: std.filled,
    generatedAt: new Date().toISOString(),
  }

  await db
    .prepare(
      "UPDATE projects SET status = 'calculated', standard_id = ?, result_json = ?, updated_at = now() WHERE id = ?"
    )
    .run(std.id, JSON.stringify(result), id)

  return { result }
})
