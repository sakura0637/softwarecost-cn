// 统一数据维护：可维护业务表注册表（单一事实源）。
// 后端通用 CRUD / 导入导出、前端左树右表都读这里。
// 列类型/主键通过 information_schema 运行时内省，本配置只标注「特殊列」：
//   readonly 只读（自动管理或遗留列，不出现在编辑表单）
//   json     存为 TEXT 的 JSON 列（前端用文本域，导入时校验 parse）
//   fk       外键列 → 引用表与显示列（前端渲染下拉）
//   groupBy  按该列分组渲染（分组表头 + 角色徽标，见 config/rowGroups.ts）
// 注意：本文件是纯静态数据 + 类型，无任何 server-only 依赖，前后端均可 import。

import { CALC_LABELS } from './rowGroups'

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
  groupBy?: string // 按此列做分组渲染；分组角色声明见 config/rowGroups.ts
}

export const DATA_CATEGORIES = [
  { key: 'standards', label: '造价标准' },
  { key: 'pricing', label: '地区费率' },
  { key: 'benchmarks', label: '行业基准' },
  { key: 'defaults', label: '全局兜底' },
  { key: 'om', label: '运维参数' },
]

// ── 表与「算钱」的关系声明（2026-09-17 全量审计产出）────────────────────
// 为什么需要这张声明表：后台里多张表都长着「启用 / 来源 / 适用引擎」的开关模样，
// 但只有一部分真的被引擎读取。不强制声明，就会反复出现「改了没反应」的困惑。
// 做法与 rowGroups.ts 同源：**声明 + 自检断言比对真实消费方**，声明漏了或写错了就报红。
//
// role 取值：
//   engine  引擎会读，改这里会改变测算金额
//   page    只喂页面/接口展示，改这里不影响任何金额
//   dead    当前没有任何引擎、接口或页面读它
//   archive 测算结果的快照，本身不参与计算
//
// inert 取值：本表里「看着像开关、实际不参与任何计算」的列。
// 一经登记，check:enums 就会强制要求该列的中文标签出现在本表 hint 里 —— 必须向用户交代清楚。
export type CalcRole = 'engine' | 'page' | 'dead' | 'archive'

export const CALC_ROLE_LABELS: Record<CalcRole, { label: string; note: string }> = {
  engine: { label: '参与计算', note: '引擎会读这张表，改这里会改变测算金额' },
  page: { label: '仅页面展示', note: '只喂页面，改这里不影响任何测算金额' },
  dead: { label: '当前无消费方', note: '没有引擎、接口或页面读它，改动不产生任何效果' },
  archive: { label: '历史存档', note: '测算结果的快照，本身不参与计算' },
}

export const TABLE_CALC_ROLES: Record<string, { role: CalcRole; inert?: string[]; reason: string }> = {
  standards: {
    role: 'page', inert: ['is_enabled', 'source'],
    reason: '只是标准目录，被 /standards 页与 /api/standards 读取；计价引擎读的是 estimation_parameters',
  },
  standard_parameters: {
    role: 'page',
    reason: '只被 /standards 页展开显示与维护，不进任何计算',
  },
  standard_benchmarks: {
    role: 'engine', inert: ['ufp_method', 'ufp_weights', 'reuse_factors', 'cf', 'pdr', 'hm', 'rate', 'adjustment_factors'],
    reason: 'standard 驱动主表：algorithm（用哪套功能点方法）与 complexity_rules（复杂度判定矩阵）已被 pricingParams 读取；其余取值列待第二步接入',
  },
  pricing_defaults: {
    role: 'engine',
    reason: '全局兜底参数：功能点方法库、复杂度判定矩阵、兜底 HM/PDR、省份→代表城市。引擎在这些取不到标准值时读它',
  },
  estimation_benchmarks: {
    role: 'page', inert: ['is_active'],
    reason: '被 /industry 页经 /api/estimation-benchmarks 读取；旧结构，新数据不写这里',
  },
  estimation_parameters: {
    role: 'engine',
    reason: '计价引擎唯一读取的参数表（pricingStandards.ts），决定可测算的标准档位与其 PDR / 费率',
  },
  provincial_pricing: {
    role: 'dead',
    reason: '仅有一个无人调用的只读接口 /api/provincial-pricing；/city 页已改读 city_rates',
  },
  city_rates: {
    role: 'engine',
    reason: '城市费率曲线 + 计价引擎按城市补费率；注意仅每城最新年份进计算',
  },
  om_wage_base: {
    role: 'engine',
    reason: '两法人工成本锚点；C.1 锚点由 is_default 决定，「用途」列只有 quota 这一个值真生效',
  },
  om_factors: {
    role: 'engine', inert: ['engine', 'unit'],
    reason: '双引擎全部调整系数；引擎按 group_key + calc 取数，不看 engine 列',
  },
  om_rate_items: {
    role: 'engine',
    reason: '费率项；engine 与 base_note 都被引擎真实读取',
  },
  om_c1_benchmarks: {
    role: 'engine', inert: ['level', 'unit'],
    reason: 'C.1 单位工作量基准；真正进公式的只有 workload 列',
  },
  om_quota_items: {
    role: 'engine', inert: ['unit'],
    reason: '定额单价库；quota / formula / kind / point_based 均被读取',
  },
  om_station_types: {
    role: 'engine',
    reason: '站点服务时间系数进计算；qty 仅作用于示例清单的「按站点数放大」',
  },
  om_device_c1_map: {
    role: 'engine',
    reason: '设备 → C.1 取费类别匹配规则表，决定每台设备按哪个类别计费',
  },
  om_projects: {
    role: 'archive',
    reason: '测算存档快照，本身不参与计算',
  },
}

export function calcRoleOf(table: string): { role: CalcRole; inert?: string[]; reason: string } | undefined {
  return TABLE_CALC_ROLES[table]
}

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
    hint: `全部造价标准的目录（国标 / 行标 / 地标 / 军标），是「标准」这一层的唯一台账。
【本表不参与任何计算】它只是目录。真正被计价引擎读取的是「行业基准参数」表（见那张表的说明），
改本表的名称 / 代号 / 摘要只影响 /standards 页的展示，不会改变任何测算金额。
【级别】national 国家标准 / provincial 省级地方标准 / municipal 市级地方标准 / industry 行业标准 / military 军用标准。
【两个入口的分工】本后台独有 Excel 批量导入导出；/standards 页则是单条录入与卡片浏览。改的是同一份数据，注意别重复录入。
【「启用」列目前不产生效果】引擎与 /standards 页都不过滤这一列，勾掉它不会让标准从任何列表里消失（留着备将来用）。
【「来源」列是纯标记】它不驱动任何自动行为。种子只在本表为空时灌一次，之后永不重灌，
所以不存在「随版本更新被覆盖」的风险，也不存在「人工维护被保留」的机制——来源填错了没有实际后果。
【勿改】「参数」「参数取值」是旧版 JSON 字段，已被「标准参数明细」子表取代，现仅供历史兼容，故设为只读。`,
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
    // 一份标准 N 条参数，天然该按标准分层；「所属标准」列随之隐藏 —— 组头已经写了标准名，不必每行重复
    groupBy: 'standard_id',
    hidden: ['standard_id'],
    hint: `一份标准下面 1:N 的参数明细（行式），是「标准参数明细」的正式载体，用来取代 standards 表里那两列 JSON。
【列表怎么读】按「所属标准」分层：一组表头就是一套标准，组内的行全是它的参数。表头里那串英文内码（如 scsia-0015-2025）是该标准的机器编号。
【「取值」列】直接显示参数值；一条参数有多个取值时显示前 3 个并以 … 收尾，鼠标悬停可看全，要看每条取值的完整对应关系请点「编辑」。
【一条记录 = 什么】一行就是该标准里的一条参数：参数名 + 取值(JSON) + 单位。
【参数类型】weight 权重 / factor 系数 / rate 费率 / productivity 生产率 / formula 公式。
【本表不进任何计算】计价引擎读的是「行业基准参数」，不是本表 —— 在这里改费率 / 生产率，测算页不会有任何变化。
要改影响测算的取值，请去「行业基准参数」表。两张表都有「参数名 + 取值」，容易搞混，记住这条分界。
【跨标准对照】同名参数在不同标准下取值常常不同（如人月折算系数：四川 174 人时/人月、北京 176），
分组之后可以逐组对比。改之前先看清自己点开的是哪一组，别把 A 标准的值改到 B 标准上。
【注意】取值是 JSON，改的时候要保持方括号 / 引号结构完整，否则该行会解析失败。`,
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
    hint: `「标准驱动」的主表：一个标准一行，声明这套标准该怎么算。
【本表已经生效的列】算法（用哪套功能点方法，取值是「全局测算兜底」表里方法库的键）、
复杂度判定矩阵（本标准的 RET/DET/FTR → 低/中/高，留空则用全局默认）。
改这两列会真的改变测算结果；两列都留空时统一走全局默认，不会报错。
【本表暂未生效的列（功能点方法 / 功能点权重 / 复用度因子 / CF / PDR / HM / 费率 / 调整因子）】
实测：这些取值列目前没有任何代码读取。引擎的档位（hm / 费率 / 基准生产率）读「行业基准参数」，
功能点权值读「全局测算兜底」。所以在本表改这些列不会影响任何测算 —— 要改取值请去那两张表。
【为什么暂未接入】本表缺计价引擎必需的「开发 / 运维」类别列（引擎靠它区分两档生产率，
把开发生产率套到运维标准上会算出荒谬的运维单价），接上之前不能顶替「行业基准参数」。
【何时接入】第二步：补类别列 → 写种子生成器（从「行业基准参数」映射，迁移脚本里有验证过的对应逻辑）
→ 引擎改读本表 → 回归验证金额逐项一致。届时本表才成为唯一的取值来源。`,
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
    hint: `⚠️ 历史遗留表，目前没有页面消费它。全站检索确认：只有 /api/provincial-pricing 这个只读接口引用，而该接口也没有任何页面调用（/city 页的城市费率已改读「城市费率」表）。
【各列原意】function_point_price 功能点单价(元/功能点)；productivity 生产率(人时/功能点)；labor_rate 人月费率(元/人月)；hm 人月折算(人时/人月)；rate 费率；cf 复杂度调整因子；level 级别（national 国家级 / provincial 省级）。
【建议】维护费率请改「城市费率」或「行业基准参数」；本表保留仅作历史对照，可择机下线。`,
  },
  {
    key: 'city_rates',
    label: '城市费率',
    category: 'pricing',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'source'],
    hint: `城市人月费率时序表，是 /city 页「城市费率」曲线与省市计价对比的唯一数据来源；同时被计价引擎 server/utils/pricingStandards.ts 读取，用于跨城市取费。
【结构】8 个城市 × 2021-2025 年 × 开发 / 运维两档，共 120 行，rate 单位是 元/人月。
【费率类型】development 开发期 / maintenance 运维期 —— 两档数值不同，别选错。
【数字从哪来】benchmark_org 标明基准机构：CSBMK＝《中国软件行业基准数据》、CSBSG＝《软件研发成本度量规范》基准；source 列是具体出处（/city 页的「数据来源」列直接展示它）。
【改这里的影响】⚠️ 只有每个城市「最新年份」的那两行会进测算；2021~2024 的行只喂 /city 页的曲线图，
改它们不会改变任何报价（引擎取 Math.max(year)，见 server/utils/pricingStandards.ts）。
所以要调测算口径，改最新的 2025 那两行；要修历史曲线的形状，才动早年行。
改完可到 /city 页看曲线是否仍然平滑。`,
  },
  // ── 全局兜底（标准没给参数时用它顶上；也是「不把领域常量写死在代码里」的落点）──
  {
    key: 'pricing_defaults',
    label: '全局测算兜底',
    category: 'defaults',
    pk: 'id',
    pkAuto: true,
    readonly: ['updated_at'],
    json: ['value'],
    hint: `全局兜底参数表：测算引擎在标准没有给出某项参数时读它顶上。
本表是「标准驱动」改革的落点 —— 以前 UFP 权值、兜底生产率这些东西是写死在代码里的，
现在一律从这里读，改参数不用改代码、也不用发版。
【本表五个键分别管什么】key 列写的是内部键名，取值是 JSON，改的时候要保持结构完整：
　参数键「功能点方法库」ufp_methods —— 功能点方法（详细功能点法 / 快速功能点法 / 全功能点法）各自
　　的类型权值，以及复杂度的判定矩阵入口。各标准用哪一套由「标准基准取值」表的算法列指定。
　参数键「复杂度判定矩阵」complexity_rules —— 由 RET/DET/FTR 判定「低/中/高」的阈值矩阵。
　　ILF/EIF 看 RET×DET，EI/EO/EQ 看 FTR×DET（三类事务阈值不同）。这是本次新补上的一环：
　　以前系统根本没有复杂度判定规则，只能让 AI 拍脑袋填。
　参数键「人月折算系数兜底值」fallback_hm —— 标准没给人月折算系数时用（174 人时/人月）。
　参数键「基准生产率兜底值」fallback_pdr —— 标准「声明了生产率但没给数值」时用；开发与运维两档
　　差一个数量级，不可混用（把开发生产率套到运维标准上会算出荒谬的单价）。
　参数键「省份 → 代表城市」province_city —— 标准没给费率时，按该省代表城市取城市费率补齐。
【改完何时生效】立即生效，无需重启。但取不到、JSON 坏、矩阵结构不合法时会当场报错拒绝测算
　（宁可测算失败也不给错数），所以改完请先核对 JSON 结构无误。
【写入策略】首次部署灌入；已存在的键不会被部署覆盖（后台改过的值保留）。`,
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
    hint: `⚠️ 历史表（仅页面展示），新数据不要写这里。这是主从重构之前的结构：一份标准的多套取值挤在一张表里（同一标准重复多行）。
【谁在读它】只有 /industry 页通过 /api/estimation-benchmarks 读取做总览展示；计价引擎不读本表。
所以改本表只影响那个页面的显示，不影响任何测算金额。
【「启用」列不产生效果】全站没有任何地方按它过滤，勾掉它不会让任何数据消失（留作将来用）。
【级别】national 国家级 / provincial 省级。
【该改哪张】要改真正影响测算的取值，请改「行业基准参数」（档位）与「全局测算兜底」（功能点权值 / 复杂度矩阵 / 兜底值）；
「标准基准取值」现在只声明「这套标准用哪套算法、哪套复杂度矩阵」，它的取值列尚未接入，写那里不生效。
【新版结构】重构后本表已拆成「造价标准 + 标准基准取值（1:1）」，本表仅为兼容历史数据与旧接口保留。`,
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
    hint: `★ 这张表是「标准 → 测算档位」的权威源：计价引擎（server/utils/pricingStandards.ts）读它。
它直接决定测算页能选到哪些标准、各标准的 PDR / 费率是多少 —— 也就是说，改这里等于改报价。
【和另外几张标准表的分工（最容易搞混的地方）】
· 造价标准 = 只有目录（名称 / 代号 / 摘要），不参与计算；
· 标准参数明细 = 只给 /standards 页展示看，不参与计算；
· 标准基准取值 = 只声明「这套标准用哪套算法、哪套复杂度矩阵」，取值列暂未接入；
· 全局测算兜底 = 功能点权值 / 复杂度判定矩阵 / 兜底 HM·PDR / 省份→城市（标准没给时顶上的那部分）；
· 本表 = 引擎取档位（hm / 费率 / 基准生产率 / 调整因子选项）的地方。
三处各管一段，想知道「改哪个数会动金额」，先看本段的分工。
【「启用」列会真的生效】取消勾选后，该参数不再进入引擎（按 is_active IS NOT FALSE 过滤），
可能让某个标准从测算页的档位里消失或失去生产率 / 费率。
【参数类型】weight 权重 / factor 系数 / rate 费率 / productivity 生产率 / formula 公式。
【数据从哪来】省标与国标的公开取值（山东、河南、四川、山西、北京 DB11、江西 DB36 等），由种子灌入或人工维护。
【同标准下各行会聚合】引擎按 standard_id 分组，取该组的第一行作为标准标题（名称 / 地区 / 类别），
组内 category 决定按「开发」还是「运维」取生产率 —— 见下条。
【category 最要紧】它填「开发」或「运维」，决定引擎用哪一档生产率：开发基准 P50 ≈ 6.72 人时/FP、
运维 ≈ 1.07 人时/FP，差一个数量级。填错会把开发生产率套到运维标准上，算出荒谬的运维单价。
【注意】param_type 写错会导致该参数在计价页被整条忽略（引擎按类型分类取用），不确定就对照同标准的其它行。`,
  },
  // ── 运维参数（双引擎测算的全部输入）──
  {
    key: 'om_wage_base',
    label: '人工成本基数',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
    hint: `两法的人工成本锚点。这个值决定全表人工费，改它等于改整个测算结果。
【为什么有 3 行】两法锚点不同，靠「用途」列区分，不是随便挑一行：
· C.1 法锚点（勾了「默认基数」那行）= 11436.9167 元/月 → 11436.9167 × 12 = 137243 元/年。出处：源表《参照的基本信息》E11，2025 年河北省「信息传输、软件和信息技术服务业」在岗平均值。
· 定额法锚点（用途 = 定额法锚点）= 11402.75 元/月 = 136833 ÷ 12。出处：源表《设备台账》定额页 D3，河北省信息技术行业城镇平均工资（2025 年 136833 元/年、2008 年 39340 元/年）。
· 仅参考 = 8674.8333 元/月，全省全行业平均，不参与任何计算。
【影响面】C.1 法：日工资 = 本表月工资 ÷ 月计薪天数，再乘人天得人工费；定额法：联动定额库里写 month_wage 的条目（PLC应用系统、UNITY PRO，按功能点计价）。
【月计薪天数】21.75 是国家法定月计薪天数（261 ÷ 12），改它也会影响日工资折算。
【两处锚点为什么不一样】两个源表各自用了不同口径的工资（137243 与 136833 元/年），本系统如实照搬，不要去「统一」它们，否则与源表口径不符。
【⚠️「用途」列只生效了一半 —— 这条最容易踩】引擎实际只比较「用途」里的一个值：定额法锚点（usage='quota'）。
C.1 法的锚点并不是由「用途」列决定的，而是由「默认基数」这个勾选决定的（引擎取勾了默认基数的那行，
没勾则取第一行）；「仅参考」这一档引擎从头到尾不读。
所以：想换 C.1 法锚点，请把「默认基数」改勾到目标行；只把「用途」改成 C.1 法锚点是不起作用的。
【勾选「默认基数」请务必只有一行】多行同时勾选时，引擎取排序在前的那行，行为不易预测。
改动这个勾选会直接改变 C.1 法全线人工费（11436.9167 → 8674.8333 即降约 24%），改前先存档。`,
  },
  {
    key: 'om_factors',
    label: '调整因子',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // group_key 是引擎的分组键（代码里按它取数，如页面硬编码 mgmt_service），
    // 列表不展示（group_name 已有中文），但**不能设只读** —— 它是 NOT NULL 无默认值，
    // 只读会让「新增」插入失败。改为配中文枚举，编辑时用下拉选，杜绝手写英文出错。
    hidden: ['group_key'],
    groupBy: 'group_key', // 按分组渲染：表头显示组名 + 本组怎么进公式（见 config/rowGroups.ts）
    hint: `两法的全部调整系数，每一分钱的乘数都在这张表里。列表按「因子分组」分层显示，表头写明这一组到底算不算钱。
【先看分组表头，再看行】
· 进本组连乘 → 真正参与计算，改一处金额就变；
· 进本组加权平均 → 组内等级系数按「权重」列加权出结果行（人员配备系数 0.905 就是这么来的）；
· 按名取用 → 引擎按名称找这几行，名称就是接口，改名或删除会让测算当场中止（这是有意的：宁可不给数，也不给错数）；
· 备选 / 未纳入公式 → 引擎不读，改了金额不会变。运维级别要求、运维能力要求、运维系统及业务特征这三组属于「源表列了但没进公式」，仅供对照源表。
【「计算方式」列只说明本行在组内干什么】它不代表数值大小，也不代表重要性。
【⚠️「适用引擎」列目前只起记录作用，引擎不读它】引擎是按「因子分组」（group_key）取数的，与这一列无关。
把一行标成「定额单价法」却放进 c1_ 开头的组，它照样会乘进 C.1 法的结果里。
（对比：「费率项」表里的同名「适用引擎」列是真生效的，那张表会按它分层 —— 两张表同名列的效力不同，别类推。）
要让某行只作用于某一法，唯一可靠的做法是把它放进对应的组：c1_ 开头的组只被 C.1 法消费，
quota_ 开头的组只被定额法消费。跨法共用的值放 c1_workload / c1_price 这类通用组。
【「取值类型」列同样不参与计算】它只是给人读的分类标签（系数 / 等级系数 / 金额 / 人天），引擎一概不看。
（对比：「费率项」表的同名「取值类型」列是真生效的 —— 填 yuan 会把该行的计费基数改成人天。
两张表同名列效力不同，别类推。）
【系统计算行】分组合计与加权结果由引擎现算，界面上灰显、不可编辑 —— 要改结果，请改它上面那些成员行。
【权重列】只有加权项（人员配备 1~5 等级）会用到，合计应为 1；改等级系数或权重，人员配备系数自动更新。
【数字从哪来】GB/T 28827.7-2022 附录 A 参数表，或源表《调整因子（采纳)》页（见「取值依据」列）。
【「因子分组」是怎么回事】它是引擎的取数键，不在行里显示（已提升到分组表头）；编辑时是中文下拉。不要另建新分组 —— 引擎不认识的分组会被静默忽略，等于白填。`,
  },
  {
    key: 'om_rate_items',
    label: '费率项',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // 同 om_factors：group_key 列表不展示（已提升到分组表头），但必须可编辑（NOT NULL 无默认值）
    hidden: ['group_key'],
    groupBy: 'group_key',
    hint: `两法的规费 / 税费 / 管理费等取费项，决定「按什么基数收多少」。
【「计费基数」列最要紧】它用文字告诉引擎这一项乘在谁身上，共 7 种，填错会让费率乘错对象：
· 人工费 → 乘人工费（社保 25.7%、公积金 12%、意外险 1% 等规费）；
· 人天 → 按人天收固定金额（现场交通工具 100 元/天）；
· 直接费 → 乘直接费（C.1 企业管理费 12%）；
· 间接费+直接费 → 乘两费之和（C.1 利润、税金 6%）；
· 直接费+税金 → 定额法备品备件 5%；
· 备品备件 → 定额法暂列金；
· 对应区块直接费 → 指挥调度中心管理服务费（10% / 12.5% / 15% 三档）。
【适用引擎】同一个「税金」项在 C.1 法与定额法下基数不同（前者含间接费，后者只按直接费），故按引擎分列两行，别只看费用名称就改。
【为什么有的行是「停用」】源表里列了但全簿扫描确认从未被任何公式引用（措施项目费两项、备品备件、暂列金），默认停用以免重复计费；要复刻源表口径时再逐项启用。
【数字从哪来】每条都在「说明」列标了源表单元格（如 F16 = 0.12 × F4）。
【「分组」是怎么回事】它是引擎取数键（测算页按 mgmt_service 这一组取管理服务费），列表不展示；编辑时是中文下拉。不要另建新分组 —— 引擎不认识的组会被忽略。`,
  },
  {
    key: 'om_c1_benchmarks',
    label: 'C.1 单位工作量基准',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    readonly: ['created_at', 'updated_at'],
    hint: `C.1 工作量法的核心基准：每类设备「一台·套，一年要花多少运维人天」。
【这个数怎么用】工作量(人天) = 设备数量 × 单位工作量 × 工作量调整因子 × 价格调整因子（× 服务时间系数），再乘日工资得人工费。所以「单位工作量」列是本表唯一真正参与计算的数，单位是 人天/台·套·年。
【数字从哪来】全部取自《2025 年中国软件行业基准数据》附录 C.1（见「来源」列），不是本系统测算出来的。
【「借XX」是什么意思】源表造价人员给设备定取费类别时，找不到完全对应的类目就「借用」相近类目，故类别名写成「借UPS中值」「借视频监控设备」——带「借」字的是造价口径的写法，不是笔误，删掉「借」字会让匹配失效。
【「说明」列】标明该类别在源表里被多少台设备命中（如「源表命中 34 条」），可用来判断哪些类目是主力。
【「级别」列与「单位」列不参与计算】「级别」只是国标 / 行标的分类标签（用于对照来源），
「单位」仅用于展示人天口径；引擎真正读的只有「设备类别」与「单位工作量」两列。
改「级别」或「单位」不会改变任何金额。
【和「设备取费映射」的关系】测算页从设备价格库取数时，靠映射表把设备自然属性翻成这里的「设备类别」；两边的类别名必须完全一致（本表类别是映射表的取值目标），改类别名会连带失配。`,
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
    hint: `【定额值怎么填】两种填法：① 直接填固定数字（167 条这么填）；② 在「计算式」里写随参数联动的算式（182 条），引擎运行时会用后台参数现算。计算式可用 3 个变量：month_wage 月工资基数、fp_coef 功能点系数、wage_ratio 运维单价调整系数。
【计算说明 vs 计算式】列表里的「计算说明」是算式的白话翻译，只是给人看的、不参与计算；真正生效的是「计算式」（已隐藏，进「编辑」弹窗可改）。改了工资基数或调整系数后，采用算式的条目会自动跟着变，直接填数字的条目不受影响。
【数字出处】整列照抄源表《设备台账》的《定额》页（单价汇总表），最上三行是锚点、第 6 行起是 349 条定额。主流形态是「(原始定额 ÷ 12个月) × 运维单价调整系数」：
· 原始定额 = 2008 年行业维护定额（元/年），如 1200、115、112、48、96、280+120×n —— 这就是截图上那些数字的全部含义；
· ÷ 12 = 年额折成月额；
· 运维单价调整系数 = 136833 ÷ 39340 = 3.4782，作用是把 2008 年的定额价折算到 2025 年水平。
· 39340 与 136833 的权威出处就在源表《定额》I5 的原注：2008 年 39340 元/年、2025 年官方 136833 元/年（J5 注明为河北省信息技术行业城镇平均工资）。
【特殊形态】
· UPS 类：「(280 + 120 × 扩展单元数) ÷ 12 + 96 × 电池块数 ÷ 12」，再各乘调整系数。280 是基础值、120 是每个扩展单元、96 是每块蓄电池（与「12V蓄电池8块/16块」条目互证）。
· 按功能点计价的 PLC应用系统 / UNITY PRO：「月工资基数 11402.75 ÷ 176工时 × 功能点系数 0.1」。176 = 8小时 × 22工作日 = 月工时，出处是源表《定额》I11 原注「一个功能点每月（8*22）」。
【其它两个已隐藏的列】「计算式（变量写法）」是给机器看的英文写法，「源表原式（仅参考）」是源表里的原始公式（注意源表把常量写成了 ==136833/12 这种双等号瑕疵，缓存值正确、不影响口径）。
【「单位」列不参与计算】它只用于展示（台 / 套 / 项等），引擎取的是「定额值」与「计算式」。
改了「单位」不会改变任何金额；真正决定金额的是「定额值」、「计算式」、「类别」和「按点位数计价」这四列。`,
  },
  {
    key: 'om_station_types',
    label: '站点类型',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // code 是引擎的兜底匹配键（omCalculator 按 name/code/sheet_name 三选一找站），
    // 也是 NOT NULL UNIQUE 无默认值 → 不能设只读（新增会失败），改为隐藏 + 中文枚举下拉。
    hidden: ['code'],
    hint: `全项目 10 类站点的台账（指挥调度中心 / 数据备份中心 / 应急站 / 管理处 / 泵站 / 三类阀闸站 / 孤立监测点 / 水量监管终端）。
【「数量」列从哪来】全部出自 A 表《参照国标进行测算（结合配套实际）》的《运行维护总费用》页 D 列。已逐条核对：指挥调度中心 1、数据备份中心 1、区域应急调度监测站 8、管理处监控中心 8、泵站 41、孤立监测点 99 —— 均与源表一致；支线工控机 6、纯管理站 14 取自源表 D11 / D12。
⚠️ 已知偏差：「阀（闸）站（普通）」本表填 109，但源表 D10 是公式 =109-D11-D12，实为 89 个。109 是三类阀闸站的合计（89 普通 + 6 支线工控机 + 14 纯管理站），按现填法三类相加会重叠成 129 个。
该列目前只用于示例清单的「按站点数放大」（引擎计算不读它，只读「服务时间系数」），所以还没造成测算偏差，待确认后更正。
【「服务时间系数」怎么用】指挥调度中心 1.5（7×24 小时，对应《调整因子·备选》里的「服务时间·总调中心」），其余站点 1.0。引擎按清单行的站点名找到对应站型后乘这个系数，改它会直接影响计算结果。
【「源表工作表」列】对应 A 表里的工作表名（已验证 8 个完全一致），用于把清单行对回源表页码；空白的两类在源表里没有独立工作表。
【「站点编码」是怎么回事】引擎按 名称 / 编码 / 源表工作表 三者之一去找站点，所以编码是匹配键之一。列表不展示它，编辑时是中文下拉（选站型即可）；不要自行改名，否则与清单里的站点名对不上。`,
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
    hint: `把设备价格库里的设备名翻译成 C.1 取费类别的规则表。
【为什么需要它】设备库记的是「工程监控 / 实体环境 / 视频监视」这类自然属性，而 C.1 工作量法要的是「UPS五级 / 借视频监控设备 / 交换机」这类取费类别，后者是造价人员的专业判断。实测二者自动映射率只有 0.2%，所以必须靠这张可维护的规则表建立对应。
【一行规则怎么生效】三重判定：①「匹配方式」决定怎么比（设备名精确匹配 / 设备名关键词匹配）；②命中「排除词」则本条让位给下一条；③多条同时命中时，优先级数字小者胜，其次匹配内容长者胜。
【关键词规则必须配排除词】否则误伤极严重。实测教训：「UPS」不加排除词会抢走「UPS配电柜」（152 行），「精密空调」不加排除词会吃掉隔离开关箱 / 线缆 / 联动。原则是精度优先：宁可让它落到「未匹配」交人工确认，也不要给出错误的取费类别。
【「定额条目名」可以留空】留空时按设备名自动去定额库匹配；填了则强制指定。填的内容必须与「定额单价库」里的设备名完全一致，错一个字就会静默取不到值。
【未匹配到的设备不会丢】清单里淡黄高亮、标记「待确认」，不计费并进入未解析清单。
【种子来源】86 条精确名直接迁移自源表《C1取费对照表》（其 141 条计费行有 120 条在设备库中同名），另 52 条为关键词规则。`,
  },
  {
    key: 'om_projects',
    label: '运维测算项目',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // result_json / 两份快照都是系统写入的大 JSON（单个存档可达数 MB），不接受人工编辑
    readonly: ['created_at', 'updated_at', 'result_json', 'params_snapshot', 'items_snapshot'],
    // 列表里不展开快照本体，否则一页就能拖出几十 MB
    hidden: ['params_snapshot', 'items_snapshot', 'result_json'],
    fk: { wage_base_id: { table: 'om_wage_base', label: 'industry' } },
    hint: `测算存档表：每保存一次测算就落一条记录。本表不参与任何计算，它只是历史快照。
【怎么产生】在「运维费用测算」页填存档名称后点「保存当前测算」。金额由服务端重算写入，不采信页面上的数字 —— 存档是拿去对账的凭证。
【核心是两份快照，不在本表直接看】保存时会把两样东西整份存下来：
· 参数快照 = 当时生效的全部计价参数（人工成本基数 / 调整因子 / 费率项 / C.1 基准 / 定额单价库 / 站点类型）。因为参数表是覆盖式修改的，不存快照事后再也回不到当时那套口径。
· 清单快照 = 当时参与测算的每一行设备。
【复现怎么用】在测算页的存档列表点「复现」：① 用存档参数重算，金额必须与存档一致（证明这个数站得住）；② 再用当前参数重算，给出差额与差额比例；③ 列出两套参数的具体差异（哪张表、哪一条、改前改后）。这就回答了「今天再算会差多少、是哪个参数造成的」。
【注意】启用快照功能（2026-09-15）之前保存的存档没有快照，复现时会明确提示「无法复现当时口径」。
【口径提醒】同一份清单在不同参数下金额不同；对账时先看存档里那份参数快照，别拿旧存档直接与现算结果比对。
【想改参数】改的是各参数表本身，改完会在「审计日志」留痕（谁、何时、把哪个值改成了什么）。`,
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
  'standard_benchmarks.algorithm': '算法',
  'standard_benchmarks.complexity_rules': '复杂度判定矩阵',
  'pricing_defaults.id': '编号',
  'pricing_defaults.key': '参数键',
  'pricing_defaults.value': '取值（JSON）',
  'pricing_defaults.label': '名称',
  'pricing_defaults.note': '说明',
  'pricing_defaults.updated_at': '更新时间',
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
  'om_factors.weight': '权重',
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
  'om_projects.params_snapshot': '参数快照',
  'om_projects.items_snapshot': '清单快照',
  'om_projects.source_label': '清单来源',
  'om_projects.site_label': '站点范围',
  'om_projects.mgmt_service_rate': '管理服务费率',
  'om_projects.item_count': '清单行数',
  'om_projects.unresolved_count': '未匹配行数',
  'om_projects.total_amount': '存档金额(元)',
  'om_projects.operator_name': '保存人',
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
  // 全局测算兜底：key 是内部键名，列表里显示中文，避免让人对着 ufp_methods 猜
  'pricing_defaults.key': {
    ufp_methods: '功能点方法库',
    complexity_rules: '复杂度判定矩阵',
    fallback_hm: '人月折算系数兜底值',
    fallback_pdr: '基准生产率兜底值',
    province_city: '省份 → 代表城市',
  },
  // 造价标准（national/provincial/municipal/industry/military 是历史编码，页面显示中文）
  'standards.level': {
    national: '国家标准',
    provincial: '省级地方标准',
    municipal: '市级地方标准',
    industry: '行业标准',
    military: '军用标准',
  },
  'standards.source': { seed: '系统种子（首次部署灌入）', manual: '人工维护' },
  'standard_parameters.param_type': {
    weight: '权重',
    factor: '系数',
    rate: '费率',
    productivity: '生产率',
    formula: '公式',
  },
  'estimation_benchmarks.level': { national: '国家级', provincial: '省级' },
  'estimation_parameters.param_type': {
    weight: '权重',
    factor: '系数',
    rate: '费率',
    productivity: '生产率',
    formula: '公式',
  },
  'provincial_pricing.level': { national: '国家级', provincial: '省级' },
  'city_rates.rate_type': { development: '开发期', maintenance: '运维期' },
  'city_rates.benchmark_org': {
    CSBMK: 'CSBMK《中国软件行业基准数据》',
    CSBSG: 'CSBSG《软件研发成本度量规范》基准',
  },

  // 运维参数
  'om_factors.engine': { c1: 'C.1 工作量法', quota: '定额单价法', common: '两法通用' },
  'om_factors.unit': { ratio: '系数', coef: '等级系数', yuan: '金额(元)', person_day: '人天' },
  // 描述**本行在组内干什么**，不是「数值大小」。
  // 中文名与 config/rowGroups.ts 的 CALC_LABELS 同源（Excel 导出也用那一份），别在这里另写一遍。
  'om_factors.calc': CALC_LABELS,
  'om_rate_items.unit': { ratio: '费率', yuan: '金额(元)' },
  'om_rate_items.engine': { c1: 'C.1 工作量法', quota: '定额单价法', both: '两法通用' },
  // 分组键：列表里不展示（旁边有中文分组名），但编辑弹窗要用中文下拉选，
  // 免得手写英文键出错导致整组因子被引擎静默忽略。
  'om_factors.group_key': {
    c1_workload: '工作量调整因子',
    c1_price: '价格调整因子',
    c1_price_ref: '价格调整因子·备选',
    c1_staff: '人员配备等级',
    quota_level: '运维级别要求',
    quota_ability: '运维能力要求',
    quota_feature: '运维系统及业务特征',
    quota_global: '定额法全局系数',
  },
  'om_rate_items.group_key': {
    regulation: '规费',
    nonlabor: '直接非人力成本',
    measure: '措施项目费',
    overhead: '间接费',
    profit: '利润',
    tax: '税金',
    spare: '备品备件费',
    mgmt_service: '运行维护管理服务费',
    provisional: '暂列金',
  },
  // 站点编码 → 中文站名（列表不展示编码，编辑时按下拉选站型）
  'om_station_types.code': {
    dispatch_center: '指挥调度中心',
    backup_center: '数据备份中心',
    emergency_station: '区域应急调度监测站',
    manage_office: '管理处监控中心',
    pump_station: '泵站',
    gate_station: '阀（闸）站（普通）',
    branch_ipc: '阀（闸）站（支线工控机）',
    manage_only: '阀（闸）站（纯管理站）',
    isolated_point: '孤立监测点',
    water_meter: '水量监管系统终端（室外部分）',
  },
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
