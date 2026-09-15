import { loadOmParams } from '../../utils/omCalculator'

// 运维测算参数总览：测算页用它渲染「引擎切换 + 基数选择 + 系数对照」。
// 数据全部来自 om_* 参数表，后台改完刷新即生效。
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const wageBaseId = q.wage_base_id ? Number(q.wage_base_id) : null
  const p = await loadOmParams(wageBaseId)

  return {
    wageBases: p.wageBases.map((w) => ({
      id: w.id,
      label: `${w.year || ''}年 ${w.region || ''} · ${w.industry || ''}`,
      year: w.year,
      region: w.region,
      industry: w.industry,
      monthly_wage: Number(w.monthly_wage),
      work_days: Number(w.work_days),
      daily_rate: Number(w.monthly_wage) / (Number(w.work_days) || 21.75),
      is_default: w.is_default,
      source: w.source,
      note: w.note,
    })),
    wage: p.wage
      ? { id: p.wage.id, label: `${p.wage.year || ''}年 ${p.wage.industry || ''}`, monthly_wage: Number(p.wage.monthly_wage), work_days: Number(p.wage.work_days) }
      : null,
    dailyRate: p.dailyRate,
    factors: p.factors,
    rates: p.rates,
    c1: p.c1,
    quota: p.quota,
    stations: p.stations,
    counts: {
      factors: p.factors.length,
      rates: p.rates.length,
      c1: p.c1.length,
      quota: p.quota.length,
      stations: p.stations.length,
    },
  }
})
