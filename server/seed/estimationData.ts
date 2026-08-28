// 造价评估真实参数种子数据
// 全部数值从用户提供的标准原文精确抽取（非占位/非示例）：
//   四川 T/SCSIA 0015-2025、北京 DB11/T 1010-2019、全国 CSBMK(引自北京附录B)、GB/T 36964-2018
// estimation_benchmarks：完整参数集，驱动「行业基准数据」页 + 后续计价引擎
// provincial_pricing：省市计价对比，驱动「省市计价数据」页
// standardRealParams：幂等回填 standards 表被占位的 param_values

export interface EstimationBenchmark {
  id: string
  standard_code: string
  standard_name: string
  edition: string
  region: string
  level: string
  org: string
  category: string
  ufp_method: string
  ufp_weights: Record<string, Record<string, number>>
  reuse_factors: Record<string, number>
  cf: Record<string, number>
  pdr: Record<string, Record<string, number>>
  hm: number | null
  rate: number | null
  adjustment_factors: Record<string, any>
  source: string
  is_active: boolean
}

// 统一 UFP 复杂度权重（四川/北京/GB/T 36964 一致）
const UFP_WEIGHTS: Record<string, Record<string, number>> = {
  ILF: { low: 7, mid: 10, high: 15 },
  EIF: { low: 5, mid: 7, high: 10 },
  EI: { low: 3, mid: 4, high: 6 },
  EO: { low: 4, mid: 5, high: 7 },
  EQ: { low: 3, mid: 4, high: 6 },
}

// 全行业 / 电子政务 生产率基准（人时/功能点），引自 CSBMK 201809（北京 DB11/T 1010 附录B）
const PDR_ALL = { p10: 2.37, p25: 4.26, p50: 7.12, p75: 12.41, p90: 17.34 }
const PDR_GOV = { p10: 2.03, p25: 3.49, p50: 6.65, p75: 11.89, p90: 15.76 }

export const estimationBenchmarks: EstimationBenchmark[] = [
  {
    id: 'scsia-0015-2025',
    standard_code: 'T/SCSIA 0015-2025',
    standard_name: '四川省信息化项目费用测算标准',
    edition: '2025',
    region: '四川',
    level: 'provincial',
    org: '四川省软件行业协会',
    category: '软件开发',
    ufp_method: '估算功能点法(快速功能点)：UFP=10×ILF+7×EIF+4×EI+5×EO+4×EQ；预估功能点法：UFP=35×ILF+15×EIF',
    ufp_weights: UFP_WEIGHTS,
    reuse_factors: { high: 0.3333, mid: 0.6667, low: 1 },
    cf: { estimate: 1.39, budget: 1.21, operation: 1.0 },
    pdr: { all: PDR_ALL, gov: PDR_GOV },
    hm: 174,
    rate: 20000,
    adjustment_factors: {
      application_type: {
        业务处理: 1.0, 科技: 1.2, 应用集成: 1.2, 多媒体: 1.3,
        智能信息: 1.5, 系统: 1.7, 通信控制: 1.9, 流程控制: 2.0,
      },
      nonfunctional: {
        性能效率: { 明示要求: 1, 无明示: -1 },
        兼容性: { 明示要求: 1, 无明示: -1 },
        可靠性: { 明示要求: 1, 无明示: -1 },
        可移植性: { 明示要求: 1, 无明示: -1 },
        formula: '(性能效率+兼容性+可靠性+可移植性)×0.025+1',
      },
      platform: {
        'C及其他': 1.5,
        'COBOL/Golang/Python/FORTRAN/Pascal/BASIC': 1.2,
        'Java/C++/C#': 1.0,
        'PHP/JavaScript': 0.8,
      },
      team: { 本行业类似: 0.8, 其他行业或同类: 1.0, 无背景: 1.2 },
    },
    source: '四川省信息化项目费用测算标准 T/SCSIA 0015-2025 附录B/C/D',
    is_active: true,
  },
  {
    id: 'db11-1010-2019',
    standard_code: 'DB 11/T 1010—2019',
    standard_name: '信息化项目软件开发费用测算规范',
    edition: '2019',
    region: '北京',
    level: 'provincial',
    org: '北京市市场监督管理局',
    category: '软件开发',
    ufp_method: '估算功能点法：UFP=10×ILF+7×EIF+4×EI+5×EO+4×EQ',
    ufp_weights: UFP_WEIGHTS,
    reuse_factors: { high: 1, mid: 1, low: 1 }, // 北京不单列重用，规模变更因子含调整
    cf: { min: 1, max: 2, tender: 1.22 },
    pdr: { all: PDR_ALL, gov: PDR_GOV },
    hm: 176,
    rate: 25500,
    adjustment_factors: {
      application_type: {
        业务处理: 1.0, 应用集成: 1.2, 科技: 1.2, 多媒体: 1.3,
        智能信息: 1.7, 系统: 1.7, 通信控制: 1.9, 流程控制: 2.0,
      },
      quality: {
        分布式: { 无需求: -1, 网络分布: 0, 多服务器: 1 },
      },
      platform: {
        'C及其他': 1.5,
        'COBOL/Golang/Python/FORTRAN/Pascal/BASIC': 1.2,
        'Java/C++/C#': 1.0,
        'PHP/JavaScript': 0.8,
      },
      team: { 本行业类似: 0.8, 其他行业或同类: 1.0, 无背景: 1.2 },
    },
    source: 'DB11/T 1010—2019 附录B（CSBMK 201809）',
    is_active: true,
  },
  {
    id: 'csbmk-201809',
    standard_code: 'CSBMK-201809',
    standard_name: '中国软件行业基准数据',
    edition: '201809',
    region: '全国',
    level: 'national',
    org: '北京软件造价评估技术创新联盟',
    category: '行业基准数据',
    ufp_method: '功能点法',
    ufp_weights: UFP_WEIGHTS,
    reuse_factors: { high: 0.3333, mid: 0.6667, low: 1 },
    cf: { estimate: 1.39, budget: 1.21, operation: 1.0 },
    pdr: { all: PDR_ALL, gov: PDR_GOV },
    hm: 174,
    rate: 23000,
    adjustment_factors: {
      application_type: { 业务处理: 1.0, 应用集成: 1.2, 科技: 1.2, 多媒体: 1.3, 智能信息: 1.7, 系统: 1.7, 通信控制: 1.9, 流程控制: 2.0 },
      nonfunctional: { 性能效率: { 明示要求: 1, 无明示: -1 }, 兼容性: { 明示要求: 1, 无明示: -1 }, 可靠性: { 明示要求: 1, 无明示: -1 }, 可移植性: { 明示要求: 1, 无明示: -1 }, formula: '(性能效率+兼容性+可靠性+可移植性)×0.025+1' },
      platform: { 'C及其他': 1.5, 'COBOL/Golang/Python/FORTRAN/Pascal/BASIC': 1.2, 'Java/C++/C#': 1.0, 'PHP/JavaScript': 0.8 },
      team: { 本行业类似: 0.8, 其他行业或同类: 1.0, 无背景: 1.2 },
    },
    source: 'CSBMK 201809（引自 DB11/T 1010—2019 附录B）',
    is_active: true,
  },
  {
    id: 'gbt-36964-2018',
    standard_code: 'GB/T 36964-2018',
    standard_name: '软件开发成本度量规范',
    edition: '2018',
    region: '全国',
    level: 'national',
    org: '国家标准化管理委员会',
    category: '软件开发',
    ufp_method: '估算/预估功能点法',
    ufp_weights: UFP_WEIGHTS,
    reuse_factors: { high: 0.3333, mid: 0.6667, low: 1 },
    cf: { estimate: 1.39, budget: 1.21, operation: 1.0 },
    pdr: { all: PDR_ALL, gov: PDR_GOV },
    hm: null,
    rate: null,
    adjustment_factors: {
      vaf: { formula: 'VAF=0.65+0.01×Σ(14项通用系统特性，每项0~5)' },
    },
    source: 'GB/T 36964-2018 软件工程 软件开发成本度量规范',
    is_active: true,
  },
]

export interface ProvincialPricing {
  id: string
  region: string
  level: string
  function_point_price: number
  productivity: number
  labor_rate: number
  hm: number
  rate: number
  cf: number
  source: string
  year: string
}

// 生产率(FP/人月)=hm÷PDR_p50；功能点单价(元/FP)=rate÷PDR_p50；人月费率(万元/人月)=rate÷10000
export const provincialPricing: ProvincialPricing[] = [
  {
    id: 'national',
    region: '全国基准',
    level: 'national',
    function_point_price: Math.round(23000 / PDR_ALL.p50), // 3230
    productivity: Math.round((174 / PDR_ALL.p50) * 100) / 100, // 24.44
    labor_rate: 2.3,
    hm: 174,
    rate: 23000,
    cf: 1.39,
    source: 'CSBMK 201809 / GB/T 36964-2018',
    year: '2025',
  },
  {
    id: 'sichuan',
    region: '四川',
    level: 'provincial',
    function_point_price: Math.round(20000 / PDR_ALL.p50), // 2809
    productivity: Math.round((174 / PDR_ALL.p50) * 100) / 100, // 24.44
    labor_rate: 2.0,
    hm: 174,
    rate: 20000,
    cf: 1.39,
    source: 'T/SCSIA 0015-2025',
    year: '2025',
  },
  {
    id: 'beijing',
    region: '北京',
    level: 'provincial',
    function_point_price: Math.round(25500 / PDR_ALL.p50), // 3581
    productivity: Math.round((176 / PDR_ALL.p50) * 100) / 100, // 24.72
    labor_rate: 2.55,
    hm: 176,
    rate: 25500,
    cf: 1.22,
    source: 'DB 11/T 1010—2019',
    year: '2019',
  },
]

// 幂等回填 standards 表被占位的 param_values（仅覆盖仍是占位假值的行，已人工编辑的不动）
export const standardRealParams: Record<string, { params: string[]; paramValues: Record<string, string | number> }> = {
  'sc-t-0015': {
    params: ['人月费用单价', '人月折算系数', '规模变更因子', '基准生产率', '应用类型调整因子', '非功能性特征调整因子', '开发平台调整因子', '开发团队背景调整因子'],
    paramValues: {
      人月费用单价: '20000 元/人月',
      人月折算系数: 174,
      规模变更因子: '估算1.39 / 概算1.21 / 运维1.00',
      基准生产率: '参照CSBMK P50（全行业7.12 人时/FP）',
      应用类型调整因子: '业务1.0 ~ 流程2.0',
      非功能性特征调整因子: '(性能+兼容+可靠+可移植)×0.025+1',
      开发平台调整因子: 'C1.5 / Py1.2 / Java1.0 / PHP0.8',
      开发团队背景调整因子: '本行业0.8 ~ 无背景1.2',
    },
  },
  'bj-db11-1010': {
    params: ['人月折算系数', '平均人力成本费率', '生产率(电子政务)', '规模变更因子', '应用类型调整因子', '质量特征调整因子'],
    paramValues: {
      人月折算系数: 176,
      平均人力成本费率: '25500 元/人月',
      生产率: '电子政务 P50=6.65 人时/FP',
      规模变更因子: '1~2（招投标1.22）',
      应用类型调整因子: '业务1.0 ~ 流程2.0',
      质量特征调整因子: '分布式 -1/0/1',
    },
  },
  'csia-ssmbk': {
    params: ['基准生产率', '人月折算系数', '功能点单价', '数据来源'],
    paramValues: {
      基准生产率: '全行业 P50=7.12 人时/FP',
      人月折算系数: 174,
      功能点单价: '约 2809~3581 元/FP（依地区费率）',
      数据来源: 'CSBMK 201809',
    },
  },
  'bscea-csbmk': {
    params: ['基准生产率', '人月折算系数', '平均人力成本费率', '功能点调整因子'],
    paramValues: {
      基准生产率: '全行业 P50=7.12 人时/FP',
      人月折算系数: 174,
      平均人力成本费率: '2.3 万元/人月',
      功能点调整因子: '0.8~1.2',
    },
  },
  'gb-t-36964': {
    params: ['功能点复杂度权重', 'VAF公式', '功能点计数'],
    paramValues: {
      功能点复杂度权重: 'ILF 7/10/15 · EIF 5/7/10 · EI 3/4/6 · EO 4/5/7 · EQ 3/4/6',
      VAF公式: '0.65+0.01×Σ(14项通用系统特性，每项0~5)',
      功能点计数: '估算/预估功能点法',
    },
  },
}
