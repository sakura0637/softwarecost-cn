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
  json?: string[] // JSON 文本列
  fk?: Record<string, { table: string; label: string }> // 外键列 → 引用表 + 显示列
  overwriteCascade?: string[] // 覆盖导入时先清空这些从表（被本表外键依赖的表）
}

export const DATA_CATEGORIES = [
  { key: 'standards', label: '造价标准' },
  { key: 'devices', label: '设备价格库' },
  { key: 'pricing', label: '地区费率' },
  { key: 'benchmarks', label: '行业基准' },
]

export const DATA_TABLES: DataTableConf[] = [
  // ── 造价标准 ──
  {
    key: 'standards',
    label: '造价标准',
    category: 'standards',
    pk: 'id',
    pkAuto: false,
    readonly: ['params', 'param_values', 'source'],
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
    json: ['ufp_weights', 'reuse_factors', 'adjustment_factors'],
    fk: { standard_id: { table: 'standards', label: 'name' } },
  },
  // ── 设备价格库（三表）──
  {
    key: 'devices',
    label: '设备价格目录',
    category: 'devices',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at', 'source'],
    overwriteCascade: ['station_devices'],
  },
  {
    key: 'stations',
    label: '站点层级',
    category: 'devices',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'source'],
    fk: { parent_id: { table: 'stations', label: 'name' } },
    overwriteCascade: ['station_devices'],
  },
  {
    key: 'station_devices',
    label: '设备-子站对照',
    category: 'devices',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at', 'source'],
    fk: {
      subsite_id: { table: 'stations', label: 'name' },
      device_id: { table: 'devices', label: 'name' },
    },
  },
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
    json: ['ufp_weights', 'reuse_factors', 'adjustment_factors'],
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
  'standards.source': '来源',
  'standard_parameters.standard_id': '所属标准',
  'standard_parameters.param_category': '参数分类',
  'standard_parameters.param_name': '参数名称',
  'standard_parameters.param_type': '参数类型',
  'standard_parameters.unit': '单位',
  'standard_parameters.values': '取值(JSON)',
  'standard_parameters.description': '说明',
  'standard_parameters.seq': '排序',
  'standard_benchmarks.standard_id': '所属标准',
  'standard_benchmarks.ufp_method': 'UFP方法',
  'standard_benchmarks.ufp_weights': 'UFP权重',
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
  'devices.category': '顶层分类',
  'devices.subcategory': '子分类',
  'devices.name': '设备名称',
  'devices.brand_model': '品牌型号',
  'devices.unit': '单位',
  'devices.unit_price': '单价(元)',
  'devices.remark': '备注',
  'stations.parent_id': '上级(管理处)',
  'stations.name': '名称',
  'stations.level': '层级',
  'stations.type': '类型',
  'stations.is_summary': '是否汇总',
  'stations.sort_order': '排序',
  'stations.remark': '备注',
  'station_devices.subsite_id': '子站',
  'station_devices.device_id': '设备',
  'station_devices.qty': '数量',
  'station_devices.remark': '备注',
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
}

export function labelFor(table: string, col: string): string {
  return DATA_LABELS[`${table}.${col}`] || col
}

export function getTableConf(key: string): DataTableConf | undefined {
  return DATA_TABLES.find((t) => t.key === key)
}
