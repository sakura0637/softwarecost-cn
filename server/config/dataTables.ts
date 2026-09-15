// 统一数据维护：可维护业务表注册表（单一事实源）。
// 后端通用 CRUD / 导入导出、前端左树右表都读这里。
// 列类型/主键通过 information_schema 运行时内省，本配置只标注「特殊列」：
//   readonly 只读（自动管理或遗留列，不出现在编辑表单）
//   json     存为 TEXT 的 JSON 列（前端用文本域，导入时校验 parse）
//   fk       外键列 → 引用表与显示列（前端渲染下拉）
// 注意：本文件是纯静态数据 + 类型，无任何 server-only 依赖，前后端均可 import。

export interface DataTableConf {
  key: string // 物理表名
  label: string // 中文名
  category: string // 分类 key（见 DATA_CATEGORIES）
  pk?: string // 主键列，默认 'id'
  pkAuto?: boolean // 主键是否自增（SERIAL）。TEXT 主键为 false，需用户填
  readonly?: string[] // 只读列（编辑表单不渲染、INSERT/UPDATE 排除）
  hidden?: string[] // 列表**不展示**的列（编辑弹窗仍可维护）——用于公式这类对人不友好但需保留的字段
  hint?: string // 表级说明，显示在列表标题下方（讲清这张表怎么看、怎么填）
  json?: string[] // JSON 文本列
  fk?: Record<string, { table: string; label: string }> // 外键列 → 引用表 + 显示列
  overwriteCascade?: string[] // 覆盖导入时先清空这些从表（被本表外键依赖的表）
}

export const DATA_CATEGORIES = [
  { key: 'standards', label: '造价标准' },
  { key: 'pricing', label: '地区费率' },
  { key: 'benchmarks', label: '行业基准' },
  { key: 'om', label: '运维参数' },
]

// ── 运维费用测算：公式里所有数值的存放地（2026-09-15）────────────────────
// 测算引擎（server/utils/omCalculator.ts）只读这 6 张表，代码里不写死任何常数：
//   om_wage_base      人天单价 = 月均工资 ÷ 月计薪天数
//   om_factors        调整因子（工作量 / 价格 / 人员配备 / 定额法各级系数）
//   om_rate_items     规费 · 直接非人力成本 · 措施费 · 间接费 · 利润 · 税金 · 备品备件 · 管理服务费
//   om_c1_benchmarks  C.1 单位工作量基准（设备类别 → 人天/台·套·年）
//   om_quota_items    定额单价库（设备 → 元/月）
//   om_station_types  站点类型（默认数量 + 服务时间系数）
// 改这里等于改公式，改完在测算页「重算」即生效。

export const DATA_TABLES: DataTableConf[] = [
  // ── 造价标准 ──
  {
    key: 'standards',
    label: '造价标准',
    category: 'standards',
    pk: 'id',
    pkAuto: false,
    readonly: ['params', 'param_values', 'source'],
    json: ['params', 'param_values'],
  },
  {
    key: 'standard_parameters',
    label: '标准参数明细',
    category: 'standards',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
    json: ['values'],
    fk: { standard_id: { table: 'standards', label: 'name' } },
  },
  {
    key: 'standard_benchmarks',
    label: '标准基准取值',
    category: 'standards',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
    json: ['ufp_weights', 'reuse_factors', 'cf', 'pdr', 'adjustment_factors'],
    fk: { standard_id: { table: 'standards', label: 'name' } },
  },
  // ── 设备价格库三表不在本后台维护（2026-09-03 下线）──
  // devices / stations / station_devices 统一走 /admin/devices 专用页：
  //   该页有站点树形层级、删除设备时提示影响条数、操作日志可回滚，比通用表格安全得多。
  // 另：本后台「覆盖导入」会先清空 overwriteCascade 指定的从表，
  //    devices / stations 都级联 station_devices，误点一次即清空全站设备对照关系。
  // 后续如需批量导入设备 Excel，应在 /admin/devices 加专用导入按钮（带校验），不要挂到这里。
  // ── 地区费率 ──
  {
    key: 'provincial_pricing',
    label: '省级费率',
    category: 'pricing',
    pk: 'id',
    pkAuto: false,
    readonly: ['created_at', 'source'],
  },
  {
    key: 'city_rates',
    label: '城市费率',
    category: 'pricing',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'source'],
  },
  // ── 行业基准 ──
  {
    key: 'estimation_benchmarks',
    label: '行业基准（旧）',
    category: 'benchmarks',
    pk: 'id',
    pkAuto: false,
    readonly: ['created_at'],
    json: ['ufp_weights', 'reuse_factors', 'cf', 'pdr', 'adjustment_factors'],
  },
  {
    key: 'estimation_parameters',
    label: '行业基准参数',
    category: 'benchmarks',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at'],
    json: ['values'],
    fk: { standard_id: { table: 'standards', label: 'name' } },
  },
  // ── 运维参数（双引擎测算的全部输入）──
  {
    key: 'om_wage_base',
    label: '人工成本基数',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    key: 'om_factors',
    label: '调整因子',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    key: 'om_rate_items',
    label: '费率项',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    key: 'om_c1_benchmarks',
    label: 'C.1 单位工作量基准',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    key: 'om_quota_items',
    label: '定额单价库',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // formula_raw 是源表原始公式，仅作追溯参考，运行时不参与计算（真正生效的是 formula）
    readonly: ['created_at', 'updated_at', 'formula_raw'],
    // 「计算式」是给机器看的英文变量写法（month_wage/176*fp_coef），列表里不展示，
    // 改由 formula_text 显示白话说明；要改算式时进「编辑」弹窗改。
    hidden: ['formula', 'formula_raw'],
    hint:
      '定额值有两种填法：① 直接填固定数字；② 在「计算式」里写随参数联动的算式（如 month_wage/176*fp_coef），' +
      '引擎运行时会用后台参数现算。计算式可用 3 个变量：month_wage（月工资基数）、fp_coef（功能点系数）、' +
      'wage_ratio（运维单价调整系数）。列表里的「计算说明」就是算式的白话翻译，只是给人看的、不参与计算；' +
      '改了工资基数或调整系数后，采用算式的条目会自动跟着变，直接填数字的条目不受影响。',
  },
  {
    key: 'om_station_types',
    label: '站点类型',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    // 设备价格库 → 运维取费映射：测算页从设备库取数时，靠这张表把设备的
    // 自然属性（工程监控 / 实体环境…）翻成 C.1 取费类别（UPS五级 / 交换机…）。
    key: 'om_device_c1_map',
    label: '设备取费映射',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
  },
  {
    key: 'om_projects',
    label: '运维测算项目',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at', 'result_json'],
    fk: { wage_base_id: { table: 'om_wage_base', label: 'industry' } },
  },
]

// 列中文标签（未列出的列回退为原始列名）
export const DATA_LABELS: Record<string, string> = {
  'standards.id': '编号',
  'standards.category': '类别',
  'standards.name': '标准名称',
  'standards.code': '标准代号',
  'standards.region': '地区',
  'standards.level': '级别',
  'standards.org': '发布机构',
  'standards.summary': '摘要',
  'standards.is_enabled': '启用',
  'standards.edition': '版次',
  'standards.effective_date': '实施日期',
  'standards.params': '参数',
  'standards.param_values': '参数取值',
  'standards.source': '来源',
  'standard_parameters.standard_id': '所属标准',
  'standard_parameters.param_category': '参数分类',
  'standard_parameters.param_name': '参数名称',
  'standard_parameters.param_type': '参数类型',
  'standard_parameters.unit': '单位',
  'standard_parameters.values': '取值',
  'standard_parameters.description': '说明',
  'standard_parameters.seq': '排序',
  'standard_benchmarks.standard_id': '所属标准',
  'standard_benchmarks.ufp_method': '功能点方法',
  'standard_benchmarks.ufp_weights': '功能点权重',
  'standard_benchmarks.reuse_factors': '复用度因子',
  'standard_benchmarks.cf': 'CF',
  'standard_benchmarks.pdr': 'PDR',
  'standard_benchmarks.hm': 'HM',
  'standard_benchmarks.rate': '费率',
  'standard_benchmarks.adjustment_factors': '调整因子',
  'estimation_benchmarks.standard_code': '标准代号',
  'estimation_benchmarks.standard_name': '标准名称',
  'estimation_benchmarks.edition': '版次',
  'estimation_benchmarks.region': '地区',
  'estimation_benchmarks.level': '级别',
  'estimation_benchmarks.org': '机构',
  'estimation_benchmarks.category': '类别',
  'estimation_benchmarks.is_active': '启用',
  'estimation_benchmarks.id': '编号',
  'estimation_benchmarks.ufp_method': '功能点方法',
  'estimation_benchmarks.ufp_weights': '功能点权重',
  'estimation_benchmarks.reuse_factors': '复用度因子',
  'estimation_benchmarks.cf': 'CF',
  'estimation_benchmarks.pdr': 'PDR',
  'estimation_benchmarks.hm': 'HM',
  'estimation_benchmarks.rate': '费率',
  'estimation_benchmarks.adjustment_factors': '调整因子',
  'estimation_benchmarks.source': '来源',
  'estimation_benchmarks.created_at': '创建时间',
  'provincial_pricing.id': '编号',
  'provincial_pricing.source': '来源',
  'provincial_pricing.created_at': '创建时间',
  'city_rates.id': '编号',
  'city_rates.source': '来源',
  'city_rates.created_at': '创建时间',
  'estimation_parameters.id': '编号',
  'estimation_parameters.created_at': '创建时间',
  'standard_benchmarks.id': '编号',
  'standard_benchmarks.source': '来源',
  'standard_benchmarks.created_at': '创建时间',
  'standard_benchmarks.updated_at': '更新时间',
  'standard_parameters.created_at': '创建时间',
  'standard_parameters.updated_at': '更新时间',
  'provincial_pricing.region': '地区',
  'provincial_pricing.level': '级别',
  'provincial_pricing.function_point_price': '功能点单价',
  'provincial_pricing.productivity': '生产率',
  'provincial_pricing.labor_rate': '人月费率',
  'provincial_pricing.hm': 'HM',
  'provincial_pricing.rate': '费率',
  'provincial_pricing.cf': 'CF',
  'provincial_pricing.year': '年份',
  'city_rates.city': '城市',
  'city_rates.city_level': '城市级别',
  'city_rates.year': '年份',
  'city_rates.rate_type': '费率类型',
  'city_rates.rate': '费率(元/人月)',
  'city_rates.benchmark_org': '基准机构',
  'estimation_parameters.standard_code': '标准代号',
  'estimation_parameters.standard_name': '标准名称',
  'estimation_parameters.edition': '版次',
  'estimation_parameters.region': '地区',
  'estimation_parameters.org': '机构',
  'estimation_parameters.category': '类别',
  'estimation_parameters.param_category': '参数分类',
  'estimation_parameters.param_name': '参数名称',
  'estimation_parameters.param_type': '参数类型',
  'estimation_parameters.unit': '单位',
  'estimation_parameters.values': '取值(JSON)',
  'estimation_parameters.description': '说明',
  'estimation_parameters.seq': '排序',
  'estimation_parameters.is_active': '启用',

  // ── 运维参数 ──
  'om_wage_base.id': '编号',
  'om_wage_base.year': '年度',
  'om_wage_base.region': '地区',
  'om_wage_base.industry': '行业',
  'om_wage_base.monthly_wage': '月均工资(元)',
  'om_wage_base.work_days': '月计薪天数',
  'om_wage_base.is_default': '默认基数',
  'om_wage_base.source': '来源',
  'om_wage_base.note': '说明',
  'om_wage_base.usage': '用途',
  'om_wage_base.created_at': '创建时间',
  'om_wage_base.updated_at': '更新时间',

  'om_factors.id': '编号',
  'om_factors.group_key': '因子分组',
  'om_factors.group_name': '分组名称',
  'om_factors.engine': '适用引擎',
  'om_factors.name': '因子名称',
  'om_factors.value': '取值',
  'om_factors.unit': '取值类型',
  'om_factors.calc': '计算方式',
  'om_factors.description': '描述',
  'om_factors.basis': '取值依据',
  'om_factors.seq': '排序',
  'om_factors.is_active': '启用',
  'om_factors.created_at': '创建时间',
  'om_factors.updated_at': '更新时间',

  'om_rate_items.id': '编号',
  'om_rate_items.group_key': '分组',
  'om_rate_items.group_name': '分组名称',
  'om_rate_items.engine': '适用引擎',
  'om_rate_items.name': '费用名称',
  'om_rate_items.rate': '费率/金额',
  'om_rate_items.unit': '取值类型',
  'om_rate_items.base_note': '计费基数',
  'om_rate_items.description': '说明',
  'om_rate_items.seq': '排序',
  'om_rate_items.is_active': '启用',
  'om_rate_items.created_at': '创建时间',
  'om_rate_items.updated_at': '更新时间',

  'om_c1_benchmarks.id': '编号',
  'om_c1_benchmarks.category': '设备类别',
  'om_c1_benchmarks.level': '级别',
  'om_c1_benchmarks.unit': '单位',
  'om_c1_benchmarks.workload': '单位工作量(人天/台·套·年)',
  'om_c1_benchmarks.source': '来源',
  'om_c1_benchmarks.note': '说明',
  'om_c1_benchmarks.seq': '排序',
  'om_c1_benchmarks.is_active': '启用',
  'om_c1_benchmarks.created_at': '创建时间',
  'om_c1_benchmarks.updated_at': '更新时间',

  'om_quota_items.id': '编号',
  'om_quota_items.name': '设备名称',
  'om_quota_items.unit': '单位',
  'om_quota_items.quota': '定额值(元/月)',
  'om_quota_items.kind': '类别',
  'om_quota_items.point_based': '按点位数计价',
  'om_quota_items.formula': '计算式（变量写法）',
  'om_quota_items.formula_text': '计算说明',
  'om_quota_items.formula_raw': '源表原式（仅参考）',
  'om_quota_items.source': '来源',
  'om_quota_items.note': '说明',
  'om_quota_items.seq': '排序',
  'om_quota_items.is_active': '启用',
  'om_quota_items.created_at': '创建时间',
  'om_quota_items.updated_at': '更新时间',

  'om_station_types.id': '编号',
  'om_station_types.code': '站点编码',
  'om_station_types.name': '站点名称',
  'om_station_types.unit': '单位',
  'om_station_types.qty': '数量',
  'om_station_types.time_factor': '服务时间系数',
  'om_station_types.sheet_name': '源表工作表',
  'om_station_types.sort': '排序',
  'om_station_types.is_active': '启用',
  'om_station_types.created_at': '创建时间',
  'om_station_types.updated_at': '更新时间',

  'om_projects.id': '编号',
  'om_projects.name': '项目名称',
  'om_projects.engine': '测算引擎',
  'om_projects.year': '年度',
  'om_projects.wage_base_id': '人工成本基数',
  'om_projects.remark': '备注',
  'om_projects.result_json': '计算结果',
  'om_projects.created_at': '创建时间',
  'om_projects.updated_at': '更新时间',

  // 设备价格库 → 运维取费映射（决定「设备库」里的设备按哪个 C.1 类别计费）
  'om_device_c1_map.id': '编号',
  'om_device_c1_map.match_type': '匹配方式',
  'om_device_c1_map.match_value': '匹配内容',
  'om_device_c1_map.exclude_kw': '排除词(英文逗号分隔)',
  'om_device_c1_map.c1_category': 'C.1取费类别',
  'om_device_c1_map.quota_ref': '定额条目名',
  'om_device_c1_map.billable': '计取运维费',
  'om_device_c1_map.priority': '优先级(小者优先)',
  'om_device_c1_map.seq': '排序',
  'om_device_c1_map.is_active': '启用',
  'om_device_c1_map.note': '说明',
  'om_device_c1_map.created_at': '创建时间',
  'om_device_c1_map.updated_at': '更新时间',
}

// 枚举列的可读取值（数据维护页把存库的英文/编码渲染成中文下拉）
export const DATA_ENUMS: Record<string, Record<string, string>> = {
  'om_factors.engine': { c1: 'C.1 工作量法', quota: '定额单价法', common: '两法通用' },
  'om_factors.unit': { ratio: '系数', coef: '等级系数', yuan: '金额(元)', person_day: '人天' },
  'om_factors.calc': { multiply: '连乘', product: '分组合计', weighted: '加权平均', sum: '求和' },
  'om_rate_items.unit': { ratio: '费率', yuan: '金额(元)' },
  'om_rate_items.engine': { c1: 'C.1 工作量法', quota: '定额单价法', both: '两法通用' },
  'om_wage_base.usage': { c1: 'C.1 法锚点', quota: '定额法锚点', ref: '仅参考' },
  'om_quota_items.kind': { 硬件: '硬件', 软件: '软件' },
  'om_projects.engine': { c1: 'C.1 工作量法', quota: '定额单价法' },
  'om_device_c1_map.match_type': {
    name: '设备名精确匹配',
    keyword: '设备名关键词匹配',
    subcategory: '按子分类匹配',
    category: '按顶层分类匹配',
  },
}

export function enumFor(table: string, col: string): Record<string, string> | undefined {
  return DATA_ENUMS[`${table}.${col}`]
}

export function labelFor(table: string, col: string): string {
  return DATA_LABELS[`${table}.${col}`] || col
}

export function getTableConf(key: string): DataTableConf | undefined {
  return DATA_TABLES.find((t) => t.key === key)
}
