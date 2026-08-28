// 造价评估「城市费率时序」+「参数字典」种子
// 城市费率：从《2025年中国软件行业基准数据》页22/23 精确抽取（8 城市 × 2021-2025 × 开发/运维）
// 参数字典：从用户提供全部省标/国标原文精确抽取，对齐 mechanism /parameter 左侧分类树
// 单位统一：城市费率存储为 元/人月（原始 万元/人月 × 10000）

export interface CityRate {
  city: string
  city_level: string
  year: number
  rate_type: 'development' | 'maintenance'
  rate: number // 元/人月
  benchmark_org: string // 基准机构：CSBMK / CSBSG / 四川 / 北京 …
  source: string
}

export interface ParamValue {
  label: string
  factor: number | string
  desc?: string
}

export interface EstimationParameter {
  standard_id: string
  standard_code: string
  standard_name: string
  edition: string
  region: string
  org: string
  category: '开发' | '运维'
  param_category: string // 规模度量-功能点相关 / 规模度量-其他 / 工作量度量 / 成本估算
  param_name: string
  param_type: string // weight / factor / rate / productivity / formula
  unit: string
  values: ParamValue[]
  description: string
  seq: number
}

// ---------- 城市费率 ----------
// 数据口径：
//   CSBMK 2025：典型城市 2021-2025 软件开发/运维人月费率（页22/23）+ 当前全国37城2025单价（页13/14）+ 2024单价（页14/15）
//   CSBSG 2021：11个典型城市当前单价（《中国软件行业基准数据报告》页10）
// 单位统一：元/人月

const BENCH_CSBMK = 'CSBMK'
const BENCH_CSBSG = 'CSBSG'

// 典型城市 2021-2025 费率（万元/人月）
const CSBMK_TIME_SERIES: Record<'development' | 'maintenance', Record<string, Record<string, number>>> = {
  development: {
    北京: { '2021': 3.09, '2022': 3.23, '2023': 3.26, '2024': 3.21, '2025': 3.22 },
    上海: { '2021': 3.08, '2022': 3.10, '2023': 3.12, '2024': 3.12, '2025': 3.13 },
    广州: { '2021': 2.75, '2022': 2.85, '2023': 2.87, '2024': 2.80, '2025': 2.77 },
    深圳: { '2021': 2.98, '2022': 3.13, '2023': 3.15, '2024': 3.14, '2025': 3.21 },
    南京: { '2021': 2.70, '2022': 2.80, '2023': 2.80, '2024': 2.72, '2025': 2.78 },
    苏州: { '2021': 2.77, '2022': 2.81, '2023': 2.82, '2024': 2.78, '2025': 2.75 },
    济南: { '2021': 2.26, '2022': 2.34, '2023': 2.36, '2024': 2.33, '2025': 2.33 },
    成都: { '2021': 2.39, '2022': 2.59, '2023': 2.59, '2024': 2.65, '2025': 2.61 },
  },
  maintenance: {
    北京: { '2021': 2.55, '2022': 2.56, '2023': 2.67, '2024': 2.63, '2025': 2.63 },
    上海: { '2021': 2.58, '2022': 2.55, '2023': 2.56, '2024': 2.52, '2025': 2.53 },
    广州: { '2021': 2.29, '2022': 2.35, '2023': 2.35, '2024': 2.27, '2025': 2.26 },
    深圳: { '2021': 2.57, '2022': 2.69, '2023': 2.62, '2024': 2.61, '2025': 2.67 },
    南京: { '2021': 2.10, '2022': 2.16, '2023': 2.25, '2024': 2.15, '2025': 2.20 },
    苏州: { '2021': 2.30, '2022': 2.32, '2023': 2.30, '2024': 2.25, '2025': 2.23 },
    济南: { '2021': 1.77, '2022': 1.82, '2023': 1.91, '2024': 1.85, '2025': 1.86 },
    成都: { '2021': 1.97, '2022': 2.07, '2023': 2.09, '2024': 2.13, '2025': 2.10 },
  },
}

// 当前全国城市软件开发人月单价（元/人月）- CSBMK 2025（页13/14）
const CSBMK_DEV_2025: { city: string; rate: number; cityLevelCode: string }[] = [
  { city: '北京', rate: 32198, cityLevelCode: 'A' }, { city: '深圳', rate: 32122, cityLevelCode: 'A' },
  { city: '上海', rate: 31309, cityLevelCode: 'A' }, { city: '杭州', rate: 28813, cityLevelCode: 'A' },
  { city: '南京', rate: 27795, cityLevelCode: 'B' }, { city: '广州', rate: 27748, cityLevelCode: 'B' },
  { city: '苏州', rate: 27471, cityLevelCode: 'B' }, { city: '厦门', rate: 26823, cityLevelCode: 'B' },
  { city: '福州', rate: 26586, cityLevelCode: 'B' }, { city: '宁波', rate: 26241, cityLevelCode: 'B' },
  { city: '成都', rate: 26112, cityLevelCode: 'B' }, { city: '西安', rate: 25415, cityLevelCode: 'B' },
  { city: '合肥', rate: 24881, cityLevelCode: 'C' }, { city: '天津', rate: 24641, cityLevelCode: 'C' },
  { city: '青岛', rate: 24085, cityLevelCode: 'C' }, { city: '拉萨', rate: 23919, cityLevelCode: 'C' },
  { city: '重庆', rate: 23849, cityLevelCode: 'C' }, { city: '武汉', rate: 23806, cityLevelCode: 'C' },
  { city: '昆明', rate: 23635, cityLevelCode: 'C' }, { city: '济南', rate: 23339, cityLevelCode: 'C' },
  { city: '南昌', rate: 23296, cityLevelCode: 'C' }, { city: '长沙', rate: 23292, cityLevelCode: 'C' },
  { city: '大连', rate: 23216, cityLevelCode: 'C' }, { city: '贵阳', rate: 23155, cityLevelCode: 'C' },
  { city: '海口', rate: 22963, cityLevelCode: 'C' }, { city: '太原', rate: 22920, cityLevelCode: 'C' },
  { city: '沈阳', rate: 22752, cityLevelCode: 'C' }, { city: '南宁', rate: 22659, cityLevelCode: 'C' },
  { city: '哈尔滨', rate: 22614, cityLevelCode: 'C' }, { city: '郑州', rate: 21836, cityLevelCode: 'D' },
  { city: '长春', rate: 20954, cityLevelCode: 'D' }, { city: '兰州', rate: 20923, cityLevelCode: 'D' },
  { city: '西宁', rate: 20746, cityLevelCode: 'D' }, { city: '乌鲁木齐', rate: 20495, cityLevelCode: 'D' },
  { city: '石家庄', rate: 20410, cityLevelCode: 'D' }, { city: '呼和浩特', rate: 19883, cityLevelCode: 'E' },
  { city: '银川', rate: 19234, cityLevelCode: 'E' },
]

// CSBSG 2021 典型城市基准人月费率（万元/人月）
const CSBSG_DEV_2021: { city: string; rate: number }[] = [
  { city: '北京', rate: 30400 }, { city: '上海', rate: 29900 }, { city: '深圳', rate: 29500 },
  { city: '广州', rate: 25400 }, { city: '杭州', rate: 26800 }, { city: '苏州', rate: 24000 },
  { city: '南京', rate: 24900 }, { city: '厦门', rate: 21200 }, { city: '成都', rate: 22400 },
  { city: '武汉', rate: 21800 }, { city: '重庆', rate: 20500 },
]

function cityLevelLabel(code: string): string {
  const map: Record<string, string> = { A: '一线', B: '新一线/二线', C: '二线', D: '三线', E: '四线' }
  return map[code] || code
}

// 按 机构|类型|城市|年份 去重：8 个典型城市同时出现在「时间序列(页22/23)」和
// 「当年官方单价(页13/14)」两张表里，2025 会有两个略有出入的值（如北京 32200 / 32198）。
// 统一以当年官方单价表为准，避免折线图出现重复点。
export const cityRates: CityRate[] = (() => {
  const map = new Map<string, CityRate>()
  const key = (org: string, type: 'development' | 'maintenance', city: string, year: number) =>
    `${org}|${type}|${city}|${year}`

  // 1) CSBMK 典型城市时间序列（8城 × 5年 × 开发/运维）
  for (const [type, cities] of Object.entries(CSBMK_TIME_SERIES)) {
    const rt = type as 'development' | 'maintenance'
    for (const [city, years] of Object.entries(cities)) {
      for (const [year, wan] of Object.entries(years)) {
        map.set(key(BENCH_CSBMK, rt, city, Number(year)), {
          city,
          city_level: cityLevelLabel(CSBMK_DEV_2025.find((c) => c.city === city)?.cityLevelCode || 'B'),
          year: Number(year),
          rate_type: rt,
          rate: Math.round(wan * 10000),
          benchmark_org: BENCH_CSBMK,
          source: '《2025年中国软件行业基准数据》（CSBMK）',
        })
      }
    }
  }

  // 2) CSBMK 当前全国城市开发单价（页13/14，2025）：覆盖上表 2025 的值，并补齐其余城市
  for (const c of CSBMK_DEV_2025) {
    map.set(key(BENCH_CSBMK, 'development', c.city, 2025), {
      city: c.city,
      city_level: cityLevelLabel(c.cityLevelCode),
      year: 2025,
      rate_type: 'development',
      rate: c.rate,
      benchmark_org: BENCH_CSBMK,
      source: '《2025年中国软件行业基准数据》（CSBMK）',
    })
  }

  // 3) CSBSG 2021 典型城市开发单价（页10）
  for (const c of CSBSG_DEV_2021) {
    map.set(key(BENCH_CSBSG, 'development', c.city, 2021), {
      city: c.city,
      city_level: cityLevelLabel(CSBMK_DEV_2025.find((x) => x.city === c.city)?.cityLevelCode || 'B'),
      year: 2021,
      rate_type: 'development',
      rate: c.rate,
      benchmark_org: BENCH_CSBSG,
      source: '《中国软件行业基准数据报告》（CSBSG，SSM-BK-202109）',
    })
  }

  return Array.from(map.values()).sort((a, b) => a.year - b.year || a.rate - b.rate)
})()

// ---------- 参数字典 ----------
// 通用 UFP 权重（ILF/EIF/EI/EO/EQ 低/中/高）
function ufpWeights(): ParamValue[] {
  return [
    { label: 'ILF(低)', factor: 7 }, { label: 'ILF(中)', factor: 10 }, { label: 'ILF(高)', factor: 15 },
    { label: 'EIF(低)', factor: 5 }, { label: 'EIF(中)', factor: 7 }, { label: 'EIF(高)', factor: 10 },
    { label: 'EI(低)', factor: 3 }, { label: 'EI(中)', factor: 4 }, { label: 'EI(高)', factor: 6 },
    { label: 'EO(低)', factor: 4 }, { label: 'EO(中)', factor: 5 }, { label: 'EO(高)', factor: 7 },
    { label: 'EQ(低)', factor: 3 }, { label: 'EQ(中)', factor: 4 }, { label: 'EQ(高)', factor: 6 },
  ]
}

// 通用开发平台调整因子
const PLATFORM: ParamValue[] = [
  { label: 'C及其他同级别语言/平台', factor: 1.5 },
  { label: 'COBOL/Golang/Python/FORTRAN/Pascal/BASIC', factor: 1.2 },
  { label: 'Java/C++/C#', factor: 1.0 },
  { label: 'PHP/JavaScript', factor: 0.8 },
]

// 通用开发团队背景调整因子
const TEAM: ParamValue[] = [
  { label: '本行业类似项目', factor: 0.8 },
  { label: '其他行业或同类项目', factor: 1.0 },
  { label: '无同类项目背景', factor: 1.2 },
]

// 通用规模变更因子（估算早期/中期/晚期/交付后）
const SCALE_CHANGE: ParamValue[] = [
  { label: '估算早期（概算、预算阶段）', factor: 1.39 },
  { label: '估算中期（投标、项目计划阶段）', factor: 1.21 },
  { label: '估算晚期（需求分析阶段）', factor: 1.1 },
  { label: '项目交付后及运维阶段', factor: 1.0 },
]

const params: EstimationParameter[] = []
let SEQ = 0
function add(p: Omit<EstimationParameter, 'seq'>) {
  params.push({ ...p, seq: ++SEQ })
}

// ===== 1. 四川（开发）T/SCSIA 0015-2025 =====
{
  const sid = 'scsia-0015-2025', code = 'T/SCSIA 0015-2025', name = '四川省信息化项目费用测算标准', org = '四川省软件行业协会', region = '四川'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '估算/预估功能点法功能点复杂度权重', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '复用度调整因子', param_type: 'factor', unit: '', values: [ { label: '高（大量复用）', factor: 0.3333 }, { label: '中', factor: 0.6667 }, { label: '低（新建）', factor: 1.0 } ], description: '复用程度调整', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模变更因子', param_type: 'factor', unit: '', values: SCALE_CHANGE, description: '不同估算阶段的规模调整', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '科技', factor: 1.2 }, { label: '应用集成', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.5 }, { label: '系统', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '非功能性特征调整因子', param_type: 'factor', unit: '', values: [ { label: '性能效率（明示要求）', factor: 1 }, { label: '性能效率（无明示）', factor: -1 }, { label: '兼容性（明示要求）', factor: 1 }, { label: '兼容性（无明示）', factor: -1 }, { label: '可靠性（明示要求）', factor: 1 }, { label: '可靠性（无明示）', factor: -1 }, { label: '可移植性（明示要求）', factor: 1 }, { label: '可移植性（无明示）', factor: -1 } ], description: '公式：(性能+兼容+可靠+可移植)×0.025+1', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '开发平台调整因子', param_type: 'factor', unit: '', values: PLATFORM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '开发团队背景调整因子', param_type: 'factor', unit: '', values: TEAM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率', param_type: 'productivity', unit: '人时/功能点', values: [ { label: '全行业 P50', factor: 7.12 }, { label: '全行业 P25', factor: 4.26 }, { label: '全行业 P75', factor: 12.41 }, { label: '电子政务 P50', factor: 6.65 } ], description: '参考 CSBMK 基准生产率分位', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 174 } ], description: '每月工作人时', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '成本估算', param_name: '平均人力成本费率', param_type: 'rate', unit: '元/人月', values: [ { label: 'F', factor: 20000 } ], description: '含直接/间接人力成本及毛利润', seq: 0 })
}

// ===== 2. 北京（开发）DB11/T 1010-2019 =====
{
  const sid = 'db11-1010-2019', code = 'DB 11/T 1010—2019', name = '信息化项目软件开发费用测算规范', org = '北京市市场监督管理局', region = '北京'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模变更因子', param_type: 'factor', unit: '', values: [ { label: '招投标阶段', factor: 1.22 }, { label: '一般范围', factor: '1.0~2.0' } ], description: '规模调整因子', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '应用集成', factor: 1.2 }, { label: '科技', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.7 }, { label: '系统', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '工作量度量', param_name: '质量特征调整因子', param_type: 'factor', unit: '', values: [ { label: '分布式（无需求）', factor: -1 }, { label: '分布式（网络分布）', factor: 0 }, { label: '分布式（多服务器）', factor: 1 } ], description: '分布式处理调整', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '工作量度量', param_name: '开发平台调整因子', param_type: 'factor', unit: '', values: PLATFORM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '工作量度量', param_name: '开发团队背景调整因子', param_type: 'factor', unit: '', values: TEAM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率', param_type: 'productivity', unit: '人时/功能点', values: [ { label: '电子政务 P50', factor: 6.65 }, { label: '电子政务 P25', factor: 3.49 }, { label: '电子政务 P75', factor: 11.89 } ], description: '参考 CSBMK 附录B', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 176 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2019', region, org, category: '开发', param_category: '成本估算', param_name: '平均人力成本费率', param_type: 'rate', unit: '元/人月', values: [ { label: 'F', factor: 25500 } ], description: '', seq: 0 })
}

// ===== 3. 全国 CSBMK（开发）CSBMK-201809 =====
{
  const sid = 'csbmk-201809', code = 'CSBMK-201809', name = '中国软件行业基准数据', org = '北京软件造价评估技术创新联盟', region = '全国'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '复用度调整因子', param_type: 'factor', unit: '', values: [ { label: '高', factor: 0.3333 }, { label: '中', factor: 0.6667 }, { label: '低', factor: 1.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模变更因子', param_type: 'factor', unit: '', values: SCALE_CHANGE, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '应用集成', factor: 1.2 }, { label: '科技', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.7 }, { label: '系统', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '工作量度量', param_name: '非功能性特征调整因子', param_type: 'factor', unit: '', values: [ { label: '性能效率（明示要求）', factor: 1 }, { label: '性能效率（无明示）', factor: -1 }, { label: '兼容性（明示要求）', factor: 1 }, { label: '兼容性（无明示）', factor: -1 }, { label: '可靠性（明示要求）', factor: 1 }, { label: '可靠性（无明示）', factor: -1 }, { label: '可移植性（明示要求）', factor: 1 }, { label: '可移植性（无明示）', factor: -1 } ], description: '公式：(性能+兼容+可靠+可移植)×0.025+1', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '工作量度量', param_name: '开发平台调整因子', param_type: 'factor', unit: '', values: PLATFORM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '工作量度量', param_name: '开发团队背景调整因子', param_type: 'factor', unit: '', values: TEAM, description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率', param_type: 'productivity', unit: '人时/功能点', values: [ { label: '全行业 P10', factor: 2.37 }, { label: '全行业 P25', factor: 4.26 }, { label: '全行业 P50', factor: 7.12 }, { label: '全行业 P75', factor: 12.41 }, { label: '全行业 P90', factor: 17.34 } ], description: '功能点耗时率分位（CSBMK 201809）', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 174 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '201809', region, org, category: '开发', param_category: '成本估算', param_name: '平均人力成本费率', param_type: 'rate', unit: '元/人月', values: [ { label: 'F', factor: 23000 } ], description: '', seq: 0 })
}

// ===== 4. GB/T 36964-2018（开发） =====
{
  const sid = 'gbt-36964-2018', code = 'GB/T 36964-2018', name = '软件工程 软件开发成本度量规范', org = '国家标准化管理委员会', region = '全国'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2018', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: 'IFPUG/NESMA 复杂度权重', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2018', region, org, category: '开发', param_category: '工作量度量', param_name: '软件功能规模调整因子（VAF）', param_type: 'formula', unit: '', values: [ { label: 'VAF公式', factor: '0.65+0.01×Σ(14项通用系统特性，每项0~5)' } ], description: '通用系统特性调整', seq: 0 })
}

// ===== 5. 山西（开发）省直部门信息化建设项目支出预算方案编制规范 =====
{
  const sid = 'shanxi-dev-2025', code = '山西省省直部门信息化建设项目支出预算方案编制规范', name = '山西省信息化项目（开发）预算编制标准', org = '山西省财政厅', region = '山西'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（快速功能点法）', param_type: 'weight', unit: '', values: [ { label: 'ILF', factor: 35 }, { label: 'EIF', factor: 15 } ], description: '快速估算：UFP=35×ILF+15×EIF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（全功能点法）', param_type: 'weight', unit: '', values: [ { label: 'ILF', factor: 10 }, { label: 'EIF', factor: 7 }, { label: 'EI', factor: 4 }, { label: 'EQ', factor: 4 }, { label: 'EO', factor: 5 } ], description: '全功能点估算权重', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率', param_type: 'productivity', unit: '小时/功能点', values: [ { label: '基准', factor: 6.5 } ], description: '功能点耗时率 6.5 h/FP', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-其他', param_name: '调整因子', param_type: 'factor', unit: '', values: [ { label: 'ILF 调整因子', factor: '1.2~1.5' }, { label: '总体调整因子', factor: '1.0~1.5' } ], description: '技术复杂度调整', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '复用系数', param_type: 'factor', unit: '', values: [ { label: '功能点估算法', factor: '0.5~1.0' }, { label: '工作量估算法', factor: '0.25~1.0' } ], description: '构件复用程度', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '风险系数', param_type: 'factor', unit: '', values: [ { label: '范围', factor: '1.0~1.5' } ], description: '业务领域不熟悉时取高值', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '成本估算', param_name: '优质系数T', param_type: 'rate', unit: '', values: [ { label: 'T', factor: 1.15 } ], description: '软件企业优质系数平均取值', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '成本估算', param_name: '人工成本折算', param_type: 'formula', unit: '', values: [ { label: '开发费用公式', factor: '调整后功能点数量 × (6.5/8/22) × 人工成本' } ], description: '6.5h/FP ÷8h/天 ÷22天/月', seq: 0 })
}

// ===== 6. 山东（开发）《山东省省级政务信息化建设项目支出预算编制标准（试行）》 =====
{
  const sid = 'shandong-dev', code = '山东省省级政务信息化建设项目支出预算编制标准（试行）', name = '山东省政务信息化项目费用测算规范', org = '山东省', region = '山东'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '复用度调整因子', param_type: 'factor', unit: '', values: [ { label: '新建项目（复用度低）', factor: 1.0 }, { label: '升级改造（复用度中）', factor: 0.66 } ], description: '原则上不超过 0.66', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模调整因子', param_type: 'factor', unit: '', values: [ { label: '预估功能点法（估算早期）', factor: 1.39 }, { label: '估算功能点法（估算中期）', factor: 1.21 } ], description: '参考 CSBMK', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '科技', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.5 }, { label: '基础/支撑软件', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率', param_type: 'productivity', unit: '人时/功能点', values: [ { label: '按业务领域 P50', factor: '参考CSBMK' } ], description: '对应业务领域软件开发生产率中间值', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 174 } ], description: '8h/天 × 21.75天/月', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '试行', region, org, category: '开发', param_category: '成本估算', param_name: '基准人月费率', param_type: 'rate', unit: '元/人月', values: [ { label: '济南市基准', factor: 23300 } ], description: '参考 CSBMK 济南市典型城市费率（2025）', seq: 0 })
}

// ===== 7. 江西（开发）DB36/T 2096-2024 =====
{
  const sid = 'jiangxi-dev-2024', code = 'DB36/T 2096-2024', name = '政务信息化项目软件费用测算规范', org = '江西省', region = '江西'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模调整因子CF', param_type: 'factor', unit: '', values: [ { label: '预估功能点计数方法', factor: 1.39 }, { label: '估算功能点计数方法', factor: 1.21 }, { label: '详细功能点计数方法', factor: 1.1 } ], description: '参考 CSBMK-202410', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '应用集成', factor: 1.2 }, { label: '科学计算', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.7 }, { label: '系统平台', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '工作量度量', param_name: '开发语言/平台调整因子', param_type: 'factor', unit: '', values: [ { label: 'C及其他同级别语言/平台', factor: 1.2 }, { label: 'JAVA/C++/C#/Python及同级别', factor: 1.0 }, { label: 'PowerBuilder/ASP及同级别', factor: 0.8 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '工作量度量', param_name: '基准生产率（PDR）', param_type: 'productivity', unit: '人时/功能点', values: [ { label: 'P25', factor: 3.15 }, { label: 'P50', factor: 6.93 }, { label: 'P75', factor: 11.76 } ], description: '参考 CSBMK-202410', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 174 } ], description: '8h/天 × 21.75天/月', seq: 0 })
}

// ===== 8. 河南（开发）豫财预〔2024〕105号 =====
{
  const sid = 'henan-dev-2024', code = '豫财预〔2024〕105号', name = '河南省省级政务信息化建设项目支出预算标准', org = '河南省财政厅', region = '河南'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '工作量度量', param_name: '应用类型调整因子', param_type: 'factor', unit: '', values: [ { label: '业务处理', factor: 1.0 }, { label: '软件集成', factor: 1.2 }, { label: '科技', factor: 1.2 }, { label: '多媒体', factor: 1.3 }, { label: '智能信息', factor: 1.5 }, { label: '基础/支撑软件', factor: 1.7 }, { label: '通信控制', factor: 1.9 }, { label: '流程控制', factor: 2.0 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2024', region, org, category: '开发', param_category: '成本估算', param_name: '基准人月费率', param_type: 'rate', unit: '元/人月', values: [ { label: '参考基准数据', factor: '参考CSBMK' } ], description: '按立项当年典型城市费率计取', seq: 0 })
}

// ===== 9. GB/T 28827.7-2022（运维） =====
{
  const sid = 'gbt-28827-2022', code = 'GB/T 28827.7-2022', name = '信息技术服务 运行维护 第7部分：成本度量规范', org = '国家标准化管理委员会', region = '全国'
  const lvl = (rows: [string, number][]): ParamValue[] => rows.map(([a, b]) => ({ label: a, factor: b }))
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-更新频率', param_type: 'factor', unit: '', values: lvl([['平均每季度1次或以下', 0.95], ['平均每月1次或以下', 1.0], ['超过每月1次', 1.12]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-技术支持方式', param_type: 'factor', unit: '', values: lvl([['非现场支持为主', 0.89], ['现场支持为主', 1.0], ['纯现场支持', 1.08]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-安全等级', param_type: 'factor', unit: '', values: lvl([['第一级', 0.9], ['第二级', 0.95], ['第三级', 1.0], ['第四级', 1.05], ['第五级', 1.1]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-业务重要性', param_type: 'factor', unit: '', values: lvl([['周边', 0.9], ['一般', 1.0], ['核心', 1.1]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-响应时效', param_type: 'factor', unit: '', values: lvl([['一级故障<72h', 0.9], ['一级故障<48h', 1.0], ['一级故障<24h', 1.1]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维级别要求-软件完整性级别', param_type: 'factor', unit: '', values: lvl([['无明确/CD级', 1.0], ['AB级且特殊设计', 1.1], ['A级全生命周期特殊措施', 1.3]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维能力要求-团队经验', param_type: 'factor', unit: '', values: lvl([['本行业类似项目', 0.8], ['其他/相关项目', 1.0], ['无同类背景', 1.2]]), description: '仅适用于工作量测算', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维对象特征-软件级别', param_type: 'factor', unit: '', values: lvl([['轻量级', 0.9], ['中级', 1.0], ['重量级', 1.05]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维对象特征-软件类型', param_type: 'factor', unit: '', values: lvl([['操作系统', 0.9], ['中间件', 0.96], ['数据库', 1.0], ['开发平台', 1.05]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维对象特征-用户规模', param_type: 'factor', unit: '', values: lvl([['≤1000', 0.9], ['≤10000', 1.0], ['>10000', 1.1]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2022', region, org, category: '运维', param_category: '工作量度量', param_name: '运维对象特征-系统关联性', param_type: 'factor', unit: '', values: lvl([['无', 0.97], ['1~5个系统', 1.0], ['6个及以上', 1.14]]), description: '', seq: 0 })
}

// ===== 10. 北京（运维）DB11/T 1424-2017 =====
{
  const sid = 'db11-1424-2017', code = 'DB11/T 1424-2017', name = '信息化项目软件运维费用测算规范', org = '北京市市场监督管理局', region = '北京'
  const lvl = (rows: [string, number][]): ParamValue[] => rows.map(([a, b]) => ({ label: a, factor: b }))
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '系统更新频率', param_type: 'factor', unit: '', values: lvl([['平均每季度1次或以下', 0.95], ['平均每月1次或以下', 1.0], ['超过每月1次', 1.12]]), description: '运维水平要求因素 MLF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '技术支持方式', param_type: 'factor', unit: '', values: lvl([['非现场支持为主', 0.89], ['现场支持为主', 1.0], ['纯现场支持', 1.08]]), description: 'MLF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '运维团队经验', param_type: 'factor', unit: '', values: lvl([['本行业类似项目', 0.8], ['其他/相关项目', 1.0], ['无同类背景', 1.2]]), description: 'MCF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '部署方式', param_type: 'factor', unit: '', values: lvl([['集中式', 1.0], ['分布式', 1.06]]), description: 'MCF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '业务新颖性', param_type: 'factor', unit: '', values: lvl([['否', 0.96], ['新产品/新业务', 1.0], ['新产品+新业务', 1.09]]), description: 'MCF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '用户规模', param_type: 'factor', unit: '', values: lvl([['≤1000', 0.9], ['≤10000', 1.0], ['>10000', 1.1]]), description: 'MSF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '系统关联性', param_type: 'factor', unit: '', values: lvl([['无', 0.97], ['1~5个系统', 1.0], ['6个及以上', 1.14]]), description: 'MSF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '业务单元数', param_type: 'factor', unit: '', values: lvl([['1~5个', 0.96], ['5~10个', 1.0], ['11个以上', 1.05]]), description: 'MSF', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '工作量度量', param_name: '运维生产率（PDR）', param_type: 'productivity', unit: '人时/功能点', values: [ { label: 'P25', factor: 0.59 }, { label: 'P50', factor: 1.07 }, { label: 'P75', factor: 1.84 } ], description: '软件运维功能点耗时率', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '成本估算', param_name: '人月折算系数', param_type: 'rate', unit: '人时/人月', values: [ { label: 'HM', factor: 176 } ], description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2017', region, org, category: '运维', param_category: '成本估算', param_name: '平均人力成本费率', param_type: 'rate', unit: '元/人月', values: [ { label: 'F', factor: 19400 } ], description: '含直接/间接人力成本及毛利润', seq: 0 })
}

// ===== 11. 山西（运维）DB14/T 2163-2020 =====
{
  const sid = 'db14-2163-2020', code = 'DB14/T 2163-2020', name = '信息化项目软件运维费用测算指南', org = '山西省', region = '山西'
  const lvl = (rows: [string, number][]): ParamValue[] => rows.map(([a, b]) => ({ label: a, factor: b }))
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '系统更新频率', param_type: 'factor', unit: '', values: lvl([['平均每季度1次或以下', 0.95], ['平均每月1次或以下', 1.0], ['超过每月1次', 1.12]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '技术支持方式', param_type: 'factor', unit: '', values: lvl([['非现场支持为主', 0.89], ['现场支持为主', 1.0], ['纯现场支持', 1.08]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '运维团队经验', param_type: 'factor', unit: '', values: lvl([['本行业类似项目', 0.8], ['其他/相关项目', 1.0], ['无同类背景', 1.2]]), description: '仅适用于工作量测算', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '部署方式', param_type: 'factor', unit: '', values: lvl([['集中式', 1.0], ['分布式', 1.06]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '业务新颖性', param_type: 'factor', unit: '', values: lvl([['否', 0.96], ['新产品/新业务', 1.0], ['新产品+新业务', 1.09]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '用户规模', param_type: 'factor', unit: '', values: lvl([['≤1000', 0.9], ['≤10000', 1.0], ['>10000', 1.1]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '系统关联性', param_type: 'factor', unit: '', values: lvl([['无', 0.97], ['1~5个系统', 1.0], ['6个及以上', 1.14]]), description: '', seq: 0 })
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '工作量度量', param_name: '业务单元数', param_type: 'factor', unit: '', values: lvl([['1~5个', 0.96], ['5~10个', 1.0], ['11个以上', 1.05]]), description: '', seq: 0 })
}

// ===== 12. 河南（运维）豫财预〔2020〕67号 =====
{
  const sid = 'henan-maint-2020', code = '豫财预〔2020〕67号', name = '河南省省级信息化运行维护项目支出预算标准', org = '河南省财政厅', region = '河南'
  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2020', region, org, category: '运维', param_category: '成本估算', param_name: '运行维护费率（按购置费计取）', param_type: 'rate', unit: '%', values: [ { label: '基础设施（机房/供配电/空调等）', factor: 4 }, { label: '不间断电源主机/电池', factor: 6 }, { label: '精密/普通空调/新风/安防', factor: 6 }, { label: '电气火灾/气体灭火', factor: 7.5 }, { label: '小型机', factor: 7 }, { label: 'PC服务器', factor: 5.5 }, { label: '存储设备', factor: 6 }, { label: '核心/汇聚交换机/路由器', factor: '3~3.5' }, { label: '安全设备', factor: 8.5 }, { label: '操作系统/办公软件', factor: 5.5 }, { label: '中间件/数据库', factor: 9.5 }, { label: '虚拟化软件', factor: 7.5 }, { label: '安全软件', factor: 10 }, { label: '定制开发软件（简单）', factor: 6 }, { label: '定制开发软件（较复杂）', factor: 10 } ], description: '年维保费 = 购置费 × 费率%', seq: 0 })
}

// ===== 13. CSBMK 2025（中国软件行业基准数据 2025）=====
{
  const sid = 'csbmk-2025', code = 'CSBMK-2025', name = '中国软件行业基准数据（2025）', org = '北京软件造价评估技术创新联盟', region = '全国'

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '与 GB/T 36964-2018 一致', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '软件开发生产率（全行业分位）', param_type: 'productivity', unit: '人时/功能点', values: [
    { label: 'P10', factor: 2.20 }, { label: 'P25', factor: 3.77 }, { label: 'P50', factor: 6.72 },
    { label: 'P75', factor: 12.28 }, { label: 'P90', factor: 17.35 },
  ], description: '2025 年全行业功能点耗时率分位', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '软件开发生产率（分业务领域 P50）', param_type: 'productivity', unit: '人时/功能点', values: [
    { label: '全行业', factor: 6.72 }, { label: '电子政务', factor: 6.41 }, { label: '金融', factor: 10.46 },
    { label: '电信', factor: 8.91 }, { label: '能源', factor: 7.32 }, { label: '制造', factor: 6.85 },
    { label: '交通', factor: 7.54 },
  ], description: '2025 年各业务领域生产率中位数', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '工作量度量', param_name: '各工程活动工作量分布', param_type: 'factor', unit: '%', values: [
    { label: '需求', factor: 14.25 }, { label: '设计', factor: 12.38 }, { label: '构建', factor: 39.56 },
    { label: '测试', factor: 23.01 }, { label: '实施', factor: 10.80 },
  ], description: '2025 年全生命周期各工程活动工作量占比', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '运维', param_category: '工作量度量', param_name: '应用软件运维生产率（分位）', param_type: 'productivity', unit: '人时/功能点', values: [
    { label: 'P10', factor: 0.21 }, { label: 'P25', factor: 0.44 }, { label: 'P50', factor: 0.74 },
    { label: 'P75', factor: 1.43 }, { label: 'P90', factor: 2.07 },
  ], description: '2025 年应用软件运维功能点耗时率分位', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '运维', param_category: '成本估算', param_name: '年度运维费用占软件开发费用比例', param_type: 'factor', unit: '%', values: [
    { label: 'P10', factor: 2.26 }, { label: 'P25', factor: 5.17 }, { label: 'P50', factor: 9.02 },
    { label: 'P75', factor: 14.48 }, { label: 'P90', factor: 25.53 },
  ], description: '2025 年应用软件年度运维费用 / 开发费用比例分位', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '规模度量-其他', param_name: '规模变更因子', param_type: 'factor', unit: '', values: SCALE_CHANGE, description: '不同估算阶段的规模调整', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2025', region, org, category: '开发', param_category: '软件规模和工作量调整因子类别', param_name: '调整因子类别', param_type: 'factor', unit: '', values: [
    { label: '功能点计数项吻合度调整因子', factor: 1 }, { label: '功能点计数项修改类型调整因子', factor: 1 },
    { label: '功能点取值', factor: 1 }, { label: '规模变更因子', factor: 1 },
    { label: '开发团队背景调整因子', factor: 1 }, { label: '软件完整性级别调整因子', factor: 1 },
    { label: '开发平台调整因子', factor: 1 }, { label: '基准生产率', factor: 1 },
    { label: '应用类型调整因子', factor: 1 }, { label: '非功能性特征调整因子', factor: 1 },
    { label: '人月折算系数', factor: 1 }, { label: '平均人力成本费率', factor: 1 },
  ], description: 'CSBMK 2025 考虑的规模与工作量调整因子类别', seq: 0 })
}

// ===== 14. CSBSG 2021（中国软件行业基准数据报告 SSM-BK-202109）=====
{
  const sid = 'csbsg-2021', code = 'CSBSG-2021', name = '中国软件行业基准数据报告（SSM-BK-202109）', org = '中国软件行业协会软件造价分会', region = '全国'

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2021', region, org, category: '开发', param_category: '规模度量-功能点相关', param_name: '功能点取值（UFP权重）', param_type: 'weight', unit: '', values: ufpWeights(), description: '与 GB/T 36964-2018 一致', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2021', region, org, category: '开发', param_category: '工作量度量', param_name: '软件开发生产率（全行业分位）', param_type: 'productivity', unit: '人时/功能点', values: [
    { label: 'P10', factor: 2.26 }, { label: 'P25', factor: 4.13 }, { label: 'P50', factor: 7.16 },
    { label: 'P75', factor: 12.68 }, { label: 'P90', factor: 18.95 },
  ], description: '2021 年全行业功能点耗时率分位', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2021', region, org, category: '开发', param_category: '工作量度量', param_name: '软件开发生产率（分行业 P50）', param_type: 'productivity', unit: '人时/功能点', values: [
    { label: '政府（OA类）', factor: 5.94 }, { label: '政府（电子政务类）', factor: 7.96 },
    { label: '金融', factor: 11.63 }, { label: '电信', factor: 11.05 }, { label: '能源', factor: 7.32 },
  ], description: '2021 年各行业生产率中位数', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2021', region, org, category: '开发', param_category: '工作量度量', param_name: '各工程活动工作量分布', param_type: 'factor', unit: '%', values: [
    { label: '需求', factor: 13.56 }, { label: '设计', factor: 12.27 }, { label: '构建', factor: 40.03 },
    { label: '测试', factor: 23.95 }, { label: '实施', factor: 10.19 },
  ], description: '2021 年全生命周期各工程活动工作量占比', seq: 0 })

  add({ standard_id: sid, standard_code: code, standard_name: name, edition: '2021', region, org, category: '开发', param_category: '软件规模和工作量调整因子类别', param_name: '调整因子类别', param_type: 'factor', unit: '', values: [
    { label: '功能点取值', factor: 1 }, { label: '需求变更调整因子', factor: 1 },
    { label: '规模变更因子', factor: 1 }, { label: '开发团队背景调整因子', factor: 1 },
    { label: '软件完整性级别调整因子', factor: 1 }, { label: '开发平台调整因子', factor: 1 },
    { label: '基准生产率', factor: 1 }, { label: '应用类型调整因子', factor: 1 },
    { label: '非功能性特征调整因子', factor: 1 }, { label: '人月折算系数', factor: 1 },
    { label: '平均人力成本费率', factor: 1 },
  ], description: 'CSBSG 2021 考虑的规模与工作量调整因子类别', seq: 0 })
}

export const estimationParameters: EstimationParameter[] = params
