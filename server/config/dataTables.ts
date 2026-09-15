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
    hint: `全部造价标准的目录（国标 / 行标 / 地标 / 军标），是「标准」这一层的唯一台账。
【数据从哪来】首次部署时由系统内置种子灌入（composables/useStandards.ts），之后人工维护。
【来源列怎么认】系统种子＝随版本更新会重灌覆盖；人工维护＝重灌时保留不覆盖。
【级别】national 国家标准 / provincial 省级地方标准 / municipal 市级地方标准 / industry 行业标准 / military 军用标准。
【两个入口的分工】本后台独有 Excel 批量导入导出；/standards 页则是单条录入与卡片浏览。改的是同一份数据，注意别重复录入。
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
    hint: `一份标准下面 1:N 的参数明细（行式），是「标准参数明细」的正式载体，用来取代 standards 表里那两列 JSON。
【一条记录 = 什么】一行就是该标准里的一条参数：param_name 参数名 + values 取值(JSON) + unit 单位。
【参数类型】weight 权重 / factor 系数 / rate 费率 / productivity 生产率 / formula 公式。
【谁能吃这份数据】/standards 页按标准展开显示；测算时按「所属标准」取用。
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
    hint: `一份标准对应一套测算取值（1:1），是「用这个标准去算」时真正读取的那份参数。
【各列是什么】ufp_method 功能点方法（估算功能点 / 详细功能点）；ufp_weights 功能点权值；reuse_factors 复用度因子；cf 规模变更调整因子 CF；pdr 人时/功能点生产率；hm 人月折算（人时/人月，一般 176）；adjustment_factors 调整因子；rate 费率。
【数字从哪来】全部取自该标准正文（如 CSBMK 基准数据、GB/T 36964），不是本系统测算出来的。
【为什么和「行业基准（旧）」重复】本表 + 造价标准是主从重构后的新结构；旧表保留只为兼容历史数据，新数据请写这里。`,
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
【改这里的影响】同一城市同年份的开发 / 运维费率若填错，计价结果会整体偏移；改完可到 /city 页看曲线是否仍然平滑。`,
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
    hint: `⚠️ 历史表，新数据不要写这里。这是主从重构之前的结构：一份标准的多套取值挤在一张表里（同一标准重复多行）。
重构后已拆成「造价标准 + 标准基准取值（1:1）」两张表，本表只为兼容历史数据与旧接口保留。
【级别】national 国家级 / provincial 省级。
【该看哪张】/industry 页的行业基准数据两处都能对上；要改标准取值请改「标准基准取值」。`,
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
    hint: `参数字典：把多份国标 / 省标各自的参数逐条摊平存放，是计价标准档位（server/utils/pricingStandards.ts）的取数来源 —— 也就是说，这里的值直接决定测算页能选到哪些标准、各标准的 PDR / 费率是多少。
【参数类型】weight 权重 / factor 系数 / rate 费率 / productivity 生产率 / formula 公式。
【数据从哪来】省标与国标的公开取值（山东、河南、四川、山西、北京 DB11、江西 DB36 等），由种子灌入或人工维护。
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
【两处锚点为什么不一样】两个源表各自用了不同口径的工资（137243 与 136833 元/年），本系统如实照搬，不要去「统一」它们，否则与源表口径不符。`,
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
    hint: `两法的全部调整系数，每一分钱的乘数都在这张表里。
【「计算方式」列是关键，不能一律当连乘】
· 连乘 = 参与本组连乘，只有这一种会真的进公式；
· 备选 = 备查项，不自动进公式（如「服务时间·总调中心 1.5」是给指挥调度中心单独取用的备选值）；
· 分组合计 = 该组连乘的结果行，仅作展示与核对；
· 加权平均 = 按权重加权的结果行（如人员配备系数 0.905），仅作展示。
把「备选」误改成「连乘」会凭空多乘一个系数，这是最容易出错的地方。
【数字从哪来】GB/T 28827.7-2022 附录 A 参数表，或源表《调整因子（采纳)》页（见「取值依据」列）。
【分组】工作量调整因子（失效率 1.2 × 离散 1.8 × 复杂 1.0 = 2.16）、价格调整因子（0.8 × 1.0 × 1.4）、人员配备等级、定额法的运维级别要求 / 系统业务特征 / 全局系数。
【「因子分组」是怎么回事】它是引擎的取数键（代码里按它找组），列表不展示；编辑时是中文下拉，照着选即可。不要另建新分组 —— 引擎不认识的分组会被静默忽略，等于白填。`,
  },
  {
    key: 'om_rate_items',
    label: '费率项',
    category: 'om',
    pk: 'id',
    pkAuto: true,
    // 同 om_factors：group_key 列表不展示，但必须可编辑（NOT NULL 无默认值），配中文枚举
    hidden: ['group_key'],
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
【其它两个已隐藏的列】「计算式（变量写法）」是给机器看的英文写法，「源表原式（仅参考）」是源表里的原始公式（注意源表把常量写成了 ==136833/12 这种双等号瑕疵，缓存值正确、不影响口径）。`,
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
  // 造价标准（national/provincial/municipal/industry/military 是历史编码，页面显示中文）
  'standards.level': {
    national: '国家标准',
    provincial: '省级地方标准',
    municipal: '市级地方标准',
    industry: '行业标准',
    military: '军用标准',
  },
  'standards.source': { seed: '系统种子（随版本更新）', manual: '人工维护（重灌不覆盖）' },
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
  // ⚠️ 只有「连乘」会真的进公式（omCalculator 里只认 calc==='multiply'），
  //    其余三种都是展示/备查，故标签里直接写明，避免误选导致「改了没反应」。
  'om_factors.calc': {
    multiply: '连乘（参与计算）',
    option: '备选（不参与连乘）',
    product: '分组合计（仅展示）',
    weighted: '加权平均（仅展示）',
  },
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
