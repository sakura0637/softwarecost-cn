// 全局测算兜底种子（pricing_defaults）
//
// 【为什么有这张表】系统要「标准驱动」：换一个标准就换一整套算法与参数。
//   凡是"领域参数"都必须能从表里读到，代码里不许再出现 IFPUG 权值、兜底生产率这类字面量。
//
// 【本文件承载什么】不随单个标准变化的部分：
//   1. ufp_methods      —— 功能点方法库（详细 / 快速 / 全功能点法），各标准的 algorithm 指向其中一项
//   2. complexity_rules —— IFPUG 复杂度判定矩阵（RET/DET/FTR → 低/中/高）。此前系统完全没有这一环，
//                          复杂度只能由 AI 拍脑袋，这是本次修复的核心
//   3. fallback_hm      —— 标准没给人月折算系数时的兜底值
//   4. fallback_pdr     —— 标准声明了生产率参数、但没给具体数值时，按开发/运维分开兜底
//   5. province_city    —— 省份 → 代表城市（标准未给费率时用城市费率补齐）
//
// 【写入策略】db.ts 对每个 key 执行 INSERT ... ON CONFLICT DO NOTHING：
//   新 key 随部署自动补，已存在的 key 保留（后台人工改过的值不会被部署覆盖）。
//   若确需修正某个已发布的值，请走一次性迁移脚本显式改库，不要靠重灌。

export interface PricingDefault {
  key: string
  label: string
  note: string
  value: unknown
}

// ── 1. 功能点方法库 ────────────────────────────────────────────────
// default：没有任何标准声明算法时用哪一个（方法代号）。
// complexityBased=true：权重按「类型 + 复杂度」取（对象套对象）；
// complexityBased=false：只按类型取（数字），复杂度不参与（快速/全功能点法不分复杂度）。
const UFP_METHOD_LIBRARY = {
  default: 'ifpug-ufp',
  methods: {
    'ifpug-ufp': {
      label: '详细功能点法（IFPUG/NESMA，按复杂度取值）',
      complexityBased: true,
      weights: {
        ILF: { 低: 7, 中: 10, 高: 15 },
        EIF: { 低: 5, 中: 7, 高: 10 },
        EI: { 低: 3, 中: 4, 高: 6 },
        EO: { 低: 4, 中: 5, 高: 7 },
        EQ: { 低: 3, 中: 4, 高: 6 },
      },
    },
    'rapid-ufp': {
      label: '快速功能点法（不分复杂度，UFP = 35×ILF + 15×EIF）',
      complexityBased: false,
      weights: { ILF: 35, EIF: 15 },
    },
    'full-ufp': {
      label: '全功能点法（不分复杂度）',
      complexityBased: false,
      weights: { ILF: 10, EIF: 7, EI: 4, EO: 5, EQ: 4 },
    },
  },
}

// ── 2. 复杂度判定矩阵 ──────────────────────────────────────────────
// 结构：{ [type]: { rowBands, colBands, matrix, rowLabel, colLabel } }
//   rowBands / colBands 是各档位的「下界」，升序；取值落入「最后一个下界 ≤ 值」的那一档。
//   matrix[行档][列档] = 低|中|高
// ILF/EIF：行=RET，列=DET ；EI/EO/EQ：行=FTR，列=DET（三类事务的档位阈值各不相同，故逐类声明）
const DATA_FN = {
  rowBands: [1, 2, 6],
  colBands: [1, 20, 51],
  rowLabel: 'RET（记录元素类型数）',
  colLabel: 'DET（数据元素类型数）',
  matrix: [
    ['低', '低', '中'],
    ['低', '中', '高'],
    ['中', '高', '高'],
  ],
}
const COMPLEXITY_RULES = {
  ILF: DATA_FN,
  EIF: DATA_FN,
  EI: {
    rowBands: [0, 2, 3],
    colBands: [1, 5, 16],
    rowLabel: 'FTR（引用文件类型数）',
    colLabel: 'DET（数据元素类型数）',
    matrix: [
      ['低', '低', '中'],
      ['低', '中', '高'],
      ['中', '高', '高'],
    ],
  },
  EO: {
    rowBands: [0, 2, 4],
    colBands: [1, 6, 20],
    rowLabel: 'FTR（引用文件类型数）',
    colLabel: 'DET（数据元素类型数）',
    matrix: [
      ['低', '低', '中'],
      ['低', '中', '高'],
      ['中', '高', '高'],
    ],
  },
  EQ: {
    rowBands: [0, 2, 4],
    colBands: [1, 6, 20],
    rowLabel: 'FTR（引用文件类型数）',
    colLabel: 'DET（数据元素类型数）',
    matrix: [
      ['低', '低', '中'],
      ['低', '中', '高'],
      ['中', '高', '高'],
    ],
  },
}

export const pricingDefaults: PricingDefault[] = [
  {
    key: 'ufp_methods',
    label: '功能点方法库',
    note: '各标准用哪一套算法，由 standard_benchmarks.algorithm 指向本表 methods 里的键（ifpug-ufp / rapid-ufp / full-ufp）。标准未声明时用 default 指定的那一套。',
    value: UFP_METHOD_LIBRARY,
  },
  {
    key: 'complexity_rules',
    label: '复杂度判定矩阵',
    note: 'ILF/EIF 按 RET×DET 判定，EI/EO/EQ 按 FTR×DET 判定。标准的 standard_benchmarks.complexity_rules 可整份覆盖它。',
    value: COMPLEXITY_RULES,
  },
  {
    key: 'fallback_hm',
    label: '人月折算系数兜底值',
    note: '标准未给出人月折算系数时使用。8h/天 × 21.75 天/月 = 174 人时/人月。',
    value: { value: 174, note: '8h/天 × 21.75 天/月' },
  },
  {
    key: 'fallback_pdr',
    label: '基准生产率兜底值',
    note: '仅在该标准「确有生产率参数、只是没给数值」时使用（如山东「按业务领域 P50 参考 CSBMK」）。开发与运维差一个数量级，不可混用。',
    value: {
      development: { value: 6.72, note: 'CSBMK 2025 全行业 P50（开发），人时/功能点' },
      maintenance: { value: 1.07, note: 'DB11/T 1424-2017 北京运维 P50（运维），人时/功能点' },
    },
  },
  {
    key: 'province_city',
    label: '省份 → 代表城市',
    note: '标准未给定人月费率时，用该省代表城市的城市费率补齐。全国为空串（无代表城市）。',
    value: {
      四川: '成都',
      北京: '北京',
      山东: '济南',
      江西: '南昌',
      河南: '郑州',
      山西: '太原',
      河北: '石家庄',
      全国: '',
    },
  },
]
