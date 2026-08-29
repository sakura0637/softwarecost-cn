// 计价引擎：GB/T 36964-2018 完整测算链
//
//   UFP（未调整功能点）
//     → US  = UFP × 复用系数               （复用度调整）
//     → S   = US × CF                      （规模变更因子：估算早/中/晚期）
//     → UE  = S × PDR                      （未调整工作量，人时）
//     → AE  = UE × SWF × RDF               （调整后工作量，人时）
//          SWF（软件因素）= 应用类型 × 非功能性 × 完整性级别
//          RDF（开发因素）= 开发平台 × 开发团队背景
//     → 工作量(人月) = AE ÷ HM
//     → 费用 = 工作量(人月) × 人月费率 F
//
// 所有因子均可选，未指定时取中性值 1（即不调整），保证结果与「不调因子」时一致。

export interface FactorInput {
  cf?: number // 规模变更因子（估算早期 1.39 / 中期 1.21 / 晚期 1.10 / 交付后 1.00）
  reuse?: number // 复用系数（高 0.3333 / 中 0.6667 / 低 1.0）
  appType?: number // 应用类型（业务处理 1.0 ~ 流程控制 2.0）
  platform?: number // 开发平台（C 1.5 / Python 1.2 / Java 1.0 / PHP 0.8）
  team?: number // 开发团队背景（本行业 0.8 / 相关 1.0 / 无 1.2）
  integrityLevel?: number // 软件完整性级别（无明确 1.0 / A级 1.1~1.3）
  nfSum?: number // 非功能性 4 项之和（-4~4，每项明示=1、无明示=-1）
  teamSize?: number // 投入人数，仅用于估算工期
}

export interface CalcStep {
  key: string
  label: string
  formula: string
  value: number
  unit: string
}

export interface EngineResult {
  ufp: number
  us: number
  s: number
  pdr: number
  ue: number
  swf: number
  rdf: number
  ae: number
  hm: number
  workMonths: number
  rate: number
  cost: number
  durationMonths: number | null
  fpPrice: number // 等效功能点单价（元/FP），供对照
  steps: CalcStep[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * 非功能性特征调整因子。
 * 四川 T/SCSIA 0015、CSBMK 口径：
 *   因子 = (性能效率 + 兼容性 + 可靠性 + 可移植性) × 0.025 + 1
 *   每项「有明示要求」记 1、「无明示要求」记 -1，合计范围 -4~4 → 因子 0.90~1.10
 */
export function nonFunctionalFactor(nfSum: number): number {
  // nfSum 范围 -4~4 → 因子 0.90~1.10
  return Math.round((1 + nfSum * 0.025) * 10000) / 10000
}

export function runPricingEngine(params: {
  totalUFP: number
  pdr: number
  hm: number
  rate: number
  factors?: FactorInput
}): EngineResult {
  const f = params.factors || {}
  const ufp = Number(params.totalUFP) || 0
  const pdr = Number(params.pdr) || 0
  const hm = Number(params.hm) || 0
  const rate = Number(params.rate) || 0

  const reuse = f.reuse ?? 1
  const cf = f.cf ?? 1
  const nf = f.nfSum != null ? nonFunctionalFactor(f.nfSum) : 1
  const appType = f.appType ?? 1
  const integrity = f.integrityLevel ?? 1
  const platform = f.platform ?? 1
  const team = f.team ?? 1

  // —— 规模 ——
  const us = ufp * reuse
  const s = us * cf

  // —— 工作量 ——
  const ue = s * pdr // 人时
  const swf = appType * nf * integrity
  const rdf = platform * team
  const ae = ue * swf * rdf // 人时

  // —— 人月与费用 ——
  const workMonths = hm > 0 ? ae / hm : 0
  const cost = workMonths * rate
  const durationMonths = f.teamSize && f.teamSize > 0 ? workMonths / f.teamSize : null

  const steps: CalcStep[] = [
    { key: 'ufp', label: '未调整功能点 UFP', formula: 'Σ 各功能点复杂度权重', value: r2(ufp), unit: 'FP' },
    { key: 'us', label: '复用调整后规模 US', formula: `UFP × 复用系数 ${reuse}`, value: r2(us), unit: 'FP' },
    { key: 's', label: '规模变更调整后 S', formula: `US × 规模变更因子 ${cf}`, value: r2(s), unit: 'FP' },
    { key: 'ue', label: '未调整工作量 UE', formula: `S × 基准生产率 ${pdr}`, value: r2(ue), unit: '人时' },
    { key: 'swf', label: '软件因素 SWF', formula: `应用类型 ${appType} × 非功能 ${nf} × 完整性 ${integrity}`, value: r2(swf * 1000) / 1000, unit: '' },
    { key: 'rdf', label: '开发因素 RDF', formula: `开发平台 ${platform} × 团队背景 ${team}`, value: r2(rdf * 1000) / 1000, unit: '' },
    { key: 'ae', label: '调整后工作量 AE', formula: `UE × SWF × RDF`, value: r2(ae), unit: '人时' },
    { key: 'months', label: '工作量', formula: `AE ÷ 人月折算系数 ${hm}`, value: r2(workMonths), unit: '人月' },
    { key: 'cost', label: '测算费用', formula: `工作量 × 人月费率 ${rate.toLocaleString()}`, value: Math.round(cost), unit: '元' },
  ]
  if (durationMonths != null) {
    steps.push({
      key: 'duration',
      label: '工期',
      formula: `工作量 ÷ 投入人数 ${f.teamSize}`,
      value: r2(durationMonths),
      unit: '月',
    })
  }

  return {
    ufp: r2(ufp),
    us: r2(us),
    s: r2(s),
    pdr,
    ue: r2(ue),
    swf: r2(swf * 1000) / 1000,
    rdf: r2(rdf * 1000) / 1000,
    ae: r2(ae),
    hm,
    workMonths: r2(workMonths),
    rate,
    cost: Math.round(cost),
    durationMonths: durationMonths != null ? r2(durationMonths) : null,
    fpPrice: s > 0 ? Math.round(cost / s) : 0,
    steps,
  }
}
