// IFPUG/NESMA 未调整功能点(UFP)权重
export const UFP_WEIGHT: Record<string, Record<string, number>> = {
  ILF: { 低: 7, 中: 10, 高: 15 },
  EIF: { 低: 5, 中: 7, 高: 10 },
  EI: { 低: 3, 中: 4, 高: 6 },
  EO: { 低: 4, 中: 5, 高: 7 },
  EQ: { 低: 3, 中: 4, 高: 6 }
}

export function computeUFP(type: string, complexity: string): number {
  const t = (type || '').toUpperCase()
  const c = complexity === '高' ? '高' : complexity === '低' ? '低' : '中'
  return UFP_WEIGHT[t]?.[c] ?? 0
}

// 计价标准参数（兜底用）。前端调用 calculate 时通常直接传真实标准对象覆盖。
// 注意：unitPrice 为"元 / 未调整功能点"，以下为示例值，需替换为你手上的权威基准。
export interface PricingStandard {
  id: string
  name: string
  unitPrice: number // 元 / 功能点
  productivity?: number // 功能点 / 人月（用于人月估算）
}

export const PRICING: Record<string, PricingStandard> = {
  default: {
    id: 'default',
    name: '通用基准（示例值，待校准）',
    unitPrice: 1100
  },
  'gb-t-36964': {
    id: 'gb-t-36964',
    name: 'GB/T 36964 软件工程 软件开发成本度量规范（示例值，待校准）',
    unitPrice: 1100
  },
  hebei: {
    id: 'hebei',
    name: '河北省信息化预算编制标准（示例值，待校准）',
    unitPrice: 1000
  },
  beijing: {
    id: 'beijing',
    name: '北京市（示例值，待校准）',
    unitPrice: 1400
  },
  sichuan: {
    id: 'sichuan',
    name: '四川省（示例值，待校准）',
    unitPrice: 1050
  }
}
