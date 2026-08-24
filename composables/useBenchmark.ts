// 行业基准数据分析 —— 功能点法核心参数（参考 CSBMK / CSBSG 公开口径整理）
// 数据为演示用途的示例值，实际部署应接入权威基准数据

export interface BenchmarkParam {
  key: string
  label: string
  description: string
  value: string
  range: [number, number]
  unit: string
}

// 功能点法核心调整因子
export const adjustmentFactors: BenchmarkParam[] = [
  {
    key: 'va',
    label: '功能点计数项吻合度调整因子',
    description: '反映 AI 识别功能点与人工复核结果的吻合程度',
    value: '1.00',
    range: [0.8, 1.2],
    unit: '系数',
  },
  {
    key: 'vm',
    label: '功能点计数项修改类型调整因子',
    description: '按新增/修改/删除/复用功能点类型加权',
    value: '1.00',
    range: [0.8, 1.3],
    unit: '系数',
  },
  {
    key: 'cf',
    label: '功能点赋值规模变更因子',
    description: '项目需求规模发生变更时的规模调整',
    value: '1.00',
    range: [0.9, 1.1],
    unit: '系数',
  },
  {
    key: 'dt',
    label: '开发团队背景调整因子',
    description: '团队成熟度、领域经验对生产率的影响',
    value: '1.00',
    range: [0.8, 1.2],
    unit: '系数',
  },
  {
    key: 'ilf',
    label: '软件完整性级别调整因子',
    description: '软件关键程度（关键/中等/一般）对应的调整',
    value: '1.00',
    range: [1.0, 1.3],
    unit: '系数',
  },
  {
    key: 'pt',
    label: '开发平台调整因子',
    description: '不同开发技术平台的生产率差异',
    value: '1.00',
    range: [0.85, 1.15],
    unit: '系数',
  },
  {
    key: 'at',
    label: '应用类型调整因子',
    description: '业务处理/管理信息/科学计算等应用类型差异',
    value: '1.00',
    range: [0.9, 1.2],
    unit: '系数',
  },
  {
    key: 'nf',
    label: '非功能性特征调整因子',
    description: '性能、安全性、可用性等非功能需求对规模的影响',
    value: '1.00',
    range: [0.9, 1.3],
    unit: '系数',
  },
]

// 基础计量参数
export const baseMetrics: BenchmarkParam[] = [
  {
    key: 'pdr',
    label: '基准生产率',
    description: '单位人月完成的功能点数（功能点/人月）',
    value: '6.50',
    range: [5.0, 8.0],
    unit: '功能点/人月',
  },
  {
    key: 'hm',
    label: '人月折算系数',
    description: '1 人月折算为工作日的系数',
    value: '21.75',
    range: [21, 22],
    unit: '人天/人月',
  },
  {
    key: 'rate',
    label: '平均人力成本费率',
    description: '软件从业人员平均人力成本（含管理、质量等分摊）',
    value: '2.50',
    range: [1.8, 3.5],
    unit: '万元/人月',
  },
]

// 省市计价参数对比（示例数据）
export interface CityPricing {
  city: string
  region: string
  functionPointPrice: number // 功能点单价（元/功能点）
  productivity: number // 基准生产率（功能点/人月）
  laborRate: number // 人月费率（万元/人月）
  level: 'national' | 'provincial' | 'municipal'
}

export const cityPricing: CityPricing[] = [
  { city: '全国基准', region: '全国', functionPointPrice: 1250, productivity: 6.5, laborRate: 2.5, level: 'national' },
  { city: '北京', region: '北京', functionPointPrice: 1380, productivity: 6.2, laborRate: 3.2, level: 'provincial' },
  { city: '四川', region: '四川', functionPointPrice: 1180, productivity: 6.8, laborRate: 2.3, level: 'provincial' },
  { city: '广东', region: '广东', functionPointPrice: 1350, productivity: 6.4, laborRate: 3.0, level: 'provincial' },
  { city: '山东', region: '山东', functionPointPrice: 1200, productivity: 6.6, laborRate: 2.4, level: 'provincial' },
  { city: '山西', region: '山西', functionPointPrice: 1100, productivity: 6.9, laborRate: 2.1, level: 'provincial' },
  { city: '河北', region: '河北', functionPointPrice: 1120, productivity: 6.7, laborRate: 2.2, level: 'provincial' },
  { city: '江苏', region: '江苏', functionPointPrice: 1300, productivity: 6.3, laborRate: 2.8, level: 'provincial' },
  { city: '浙江', region: '浙江', functionPointPrice: 1320, productivity: 6.3, laborRate: 2.9, level: 'provincial' },
  { city: '成都', region: '四川-成都', functionPointPrice: 1150, productivity: 6.7, laborRate: 2.2, level: 'municipal' },
  { city: '西安', region: '陕西-西安', functionPointPrice: 1080, productivity: 7.0, laborRate: 2.0, level: 'municipal' },
  { city: '长沙', region: '湖南-长沙', functionPointPrice: 1140, productivity: 6.7, laborRate: 2.3, level: 'municipal' },
]
