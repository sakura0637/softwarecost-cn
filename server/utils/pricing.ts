// 计价基础工具
//
// ⚠️ 本文件不允许再出现任何「领域参数」字面量（UFP 权值、复杂度判定矩阵、兜底 hm/pdr、省份映射…）。
//    这些一律从数据库读，唯一取数出口是 server/utils/pricingParams.ts。
//    这里只保留纯数学推导，以及类型定义。
//
// 历史教训：UFP 权值曾在 pages/projects/[id].vue 与本文件各硬编码一份，
//   而「标准基准取值」表里又存了第三份（数值恰好相同，因为都源自 IFPUG 国际标准），
//   导致「在表里改权重完全不生效」却看不出问题。现在只有库里那一份算数。

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
