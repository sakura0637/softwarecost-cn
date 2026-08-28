// 计价基础工具
// 注意：本文件不再内置任何「示例单价」。各标准的 hm / rate / pdr 一律从数据库读取，
//      统一由 server/utils/pricingStandards.ts 的 buildPricingStandards() 提供。

// IFPUG/NESMA 未调整功能点(UFP)权重
export const UFP_WEIGHT: Record<string, Record<string, number>> = {
  ILF: { 低: 7, 中: 10, 高: 15 },
  EIF: { 低: 5, 中: 7, 高: 10 },
  EI: { 低: 3, 中: 4, 高: 6 },
  EO: { 低: 4, 中: 5, 高: 7 },
  EQ: { 低: 3, 中: 4, 高: 6 },
}

export function computeUFP(type: string, complexity: string): number {
  const t = (type || '').toUpperCase()
  const c = complexity === '高' ? '高' : complexity === '低' ? '低' : '中'
  return UFP_WEIGHT[t]?.[c] ?? 0
}

export interface PricingParams {
  hm: number // 人月折算系数（人时/人月）
  rate: number // 平均人力成本费率（元/人月）
  pdr: number // 基准生产率（人时/功能点）
}

// 由三项基础参数推导计价口径。
// ⚠️ 功能点单价 = rate ÷ (hm ÷ pdr) = rate × pdr ÷ hm
//    早期版本误写为 rate ÷ pdr（量纲无意义、单价虚高约 3.4 倍），已修正，勿回退。
export function derivePricing(p: PricingParams) {
  const productivity = p.hm / p.pdr // 功能点/人月
  const fpPrice = p.rate / productivity // 元/功能点
  return {
    productivity: Math.round(productivity * 100) / 100,
    fpPrice: Math.round(fpPrice),
    laborRateWan: Math.round((p.rate / 10000) * 100) / 100,
    hoursPerFP: p.pdr,
  }
}
