// 参数表的「分组接线声明」：每个分组**到底怎么进公式**，以及每行的「计算方式」是什么意思。
//
// 为什么要单独一张静态表：
//   1. 「是否进公式」是**组级**属性，行级 calc 只说明「本行在这组里干什么」。
//      2026-09-16 之前没有这层声明，于是没人能一眼看出「运维级别要求」这一组压根没接线，
//      而它的 13 行在界面上全写着「连乘（参与计算）」。
//   2. 只有静态声明才能被自检断言 —— check:om 拿这份声明去比对 omCalculator.ts 源码里
//      真实的 groupProduct / weightedGroupValue / requireNamedFactor / sumGroup 调用点：
//      新增分组忘了接线、改了接线忘了改声明，都会当场报红。
//   3. 前端分组表头与 Excel 导出共用同一份中文名与角色说明，杜绝「三处各写一遍、改一处漏两处」。
//
// 无任何数据库依赖，前后端与脚本都可 import。

/** 本组在引擎里的取数方式 */
export type GroupRole =
  /** 组内 calc='multiply' 的行连乘（groupProduct） */
  | 'multiply'
  /** 组内 calc='weight_item' 的行按 weight 加权平均（weightedGroupValue） */
  | 'weighted'
  /** 引擎按 group_key + name 精确定位某几行（requireNamedFactor）—— 改名即失效 */
  | 'named'
  /** 组内每行都是一条费率，按各自 base_note 指定的基数取费（sumGroup） */
  | 'rate'
  /** 备选值：引擎不自动吃，供其它表 / 页面单独取用 */
  | 'option'
  /** 未纳入公式：源表列了、但没有任何计算路径读它 */
  | 'none'

export interface RowGroupDecl {
  /** 中文组名（分组表头） */
  name: string
  role: GroupRole
  /** 运行期真正读这组的函数名，check:om 用它去 omCalculator.ts 源码里核对调用点 */
  consumer: string | null
  /** 被引擎**按名称引用**的行名（role='named' 时是主要取数方式；加权组的结果行也会被按名引用，用于老库回退）。
   *  名称就是接口：少一个引擎会当场报错，多一个就是没人用的死条目，自检两头都查。 */
  namedKeys?: string[]
  /** 表头徽标旁的说明：本组到底算不算钱、谁在取用 */
  note: string
}

export interface RowGroupConf {
  /** 用哪一列分组（表里的列名） */
  column: string
  /** 表级提示（显示在分组说明旁边） */
  hint: string
  items: Record<string, RowGroupDecl>
}

/** 行级「计算方式」的中文含义 —— 描述**本行的作用**，不是「数值大小」 */
export const CALC_LABELS: Record<string, string> = {
  multiply: '进本组连乘',
  weight_item: '加权项（进本组加权平均）',
  named: '按名取用（勿改名）',
  option: '备选值（不自动进公式）',
  listed: '源表已列·未纳入公式',
  product: '分组合计（系统计算）',
  weighted: '加权结果（系统计算）',
}

/** 系统计算结果行：值由引擎现算，后台只读、不可人工改 */
export const COMPUTED_CALC: string[] = ['product', 'weighted']

export function isComputedCalc(calc: string | null | undefined): boolean {
  return COMPUTED_CALC.includes(String(calc || ''))
}

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  multiply: '进本组连乘',
  weighted: '进本组加权平均',
  named: '按名取用',
  rate: '按计费基数取费率',
  option: '备选（不自动进公式）',
  none: '未纳入公式',
}

/** 角色 → 徽标配色（前端用，浅色底 + 深色字） */
export const GROUP_ROLE_TONE: Record<GroupRole, 'info' | 'warn' | 'muted' | 'danger'> = {
  multiply: 'info',
  weighted: 'info',
  named: 'warn',
  rate: 'info',
  option: 'muted',
  none: 'muted',
}

export const ROW_GROUPS: Record<string, RowGroupConf> = {
  // ══ 调整因子 ══════════════════════════════════════════════════
  om_factors: {
    column: 'group_key',
    hint: '「本组怎么进公式」由分组决定，行上的「计算方式」只说本行在组内干什么。只有连乘组、加权组、按名取用组会真的影响金额。',
    items: {
      c1_workload: {
        name: '工作量调整因子',
        role: 'multiply',
        consumer: 'groupProduct',
        note: 'C.1 工作量调整因子 F = 失效率 × 离散程度 × 复杂程度，直接乘在单位工作量上，改一处金额就变。',
      },
      c1_price: {
        name: '价格调整因子',
        role: 'multiply',
        consumer: 'groupProduct',
        note: 'C.1 服务级别因子 = 服务周期 × 服务频率 × 生存周期系数，与人员配备系数一起构成价格因子。',
      },
      c1_price_ref: {
        name: '价格调整因子·备选',
        role: 'option',
        consumer: null,
        note: '本组不自动进公式，只是备查取值。实际生效的服务时间系数在「站点类型」表里（总调中心 1.5 / 其余 1.0）。',
      },
      c1_staff: {
        name: '人员配备等级',
        role: 'weighted',
        consumer: 'weightedGroupValue',
        namedKeys: ['人员配备系数（加权）'],
        note: '5 个等级系数按各自权重加权平均得出人员配备系数（0.905）。改等级系数或权重 → 结果行自动联动；等级行本身不单独乘进公式。',
      },
      quota_level: {
        name: '运维级别要求',
        role: 'none',
        consumer: null,
        note: '源表列出但未纳入公式：定额法的运维费单价是定额表按设备名直接取「元/月」，没有再乘级别系数。改这里金额不会变，仅供对照源表。',
      },
      quota_ability: {
        name: '运维能力要求',
        role: 'none',
        consumer: null,
        note: '源表列出但未纳入公式，仅供对照源表。',
      },
      quota_feature: {
        name: '运维系统及业务特征',
        role: 'none',
        consumer: null,
        note: '源表列出但未纳入公式，仅供对照源表。',
      },
      quota_global: {
        name: '定额法全局系数',
        role: 'named',
        consumer: 'requireNamedFactor',
        namedKeys: [
          '年·月换算系数',
          '硬件取费调整系数',
          '软件取费调整系数',
          '运维单价调整系数',
          '功能点调整系数',
        ],
        note: '⚠️ 引擎按「名称」取这几行，名称就是接口：改名或删除会让测算当场中止（不会静默算错）。它们是定额法真正在用的乘数与推导式变量。',
      },
    },
  },

  // ══ 费率项 ════════════════════════════════════════════════════
  om_rate_items: {
    column: 'group_key',
    hint: '每个分组都是一类费用，按「计费基数」列指定的基数取费率。适用引擎不匹配的组在该法下会被整个跳过（两法尾部费用结构不同）。',
    items: {
      regulation: {
        name: '规费',
        role: 'rate',
        consumer: 'sumGroup',
        note: '社保 / 公积金 / 意外伤害险，基数为人工费。',
      },
      nonlabor: {
        name: '直接非人力成本',
        role: 'rate',
        consumer: 'sumGroup',
        note: '按人工费取费率的项与按人天取固定金额的项混排，见各行「计费基数」。',
      },
      measure: {
        name: '措施项目费',
        role: 'rate',
        consumer: 'sumGroup',
        note: '源表列而未用（D33/D34 零引用），默认已停用，启用才会计入。',
      },
      overhead: {
        name: '间接费',
        role: 'rate',
        consumer: 'sumGroup',
        note: '企业管理费，基数是直接费。',
      },
      profit: {
        name: '利润',
        role: 'rate',
        consumer: 'sumGroup',
        note: '基数为间接费 + 直接费；源表取值 0，改这里才会产生利润。',
      },
      tax: {
        name: '税金',
        role: 'rate',
        consumer: 'sumGroup',
        note: '两法的税金基数不同：C.1 法是间接费 + 直接费，定额法是直接费，故分成两行按「适用引擎」区分。',
      },
      spare: {
        name: '备品备件费',
        role: 'rate',
        consumer: 'sumGroup',
        note: 'C.1 法这行源表无公式（手工填列）默认停用；定额法那行基数是直接费 + 税金。',
      },
      provisional: {
        name: '暂列金',
        role: 'rate',
        consumer: 'sumGroup',
        note: '源表 C27 = C28（与备品备件同额），启用会重复计入，默认停用。',
      },
      mgmt_service: {
        name: '运行维护管理服务费',
        role: 'option',
        consumer: null,
        note: '三档备选（10% / 12.5% / 15%），引擎不自动取用 —— 由测算页选定一档传入，仅指挥调度中心适用。',
      },
    },
  },
}

export function rowGroupsFor(table: string): RowGroupConf | null {
  return ROW_GROUPS[table] ?? null
}

export function groupDecl(table: string, key: string): RowGroupDecl | null {
  const conf = ROW_GROUPS[table]
  if (!conf) return null
  return conf.items[key] ?? null
}

// ── 列级「这一格什么时候不算数」提示 ────────────────────────────────
// 与分组角色是同一类问题：**表格里能改的格子，不一定真的算数**。
// 已经踩到的两处：
//   · 定额单价库：写了「计算式」的 182 条，实际取值由后台参数现算，改「定额值」这一格不生效；
//   · 调整因子：分组合计 / 加权结果两行由引擎现算，改了完全不影响金额。
// 两处都在 hint 里写过，但 hint 在表格上方、行在下面，人不会带着它逐行读 —— 所以在格子上直接标。
export interface ColumnNoteRule {
  column: string
  /** 格子里显示的小徽标 */
  badge: string
  /** 悬停说明：为什么这一格不算数、该去哪儿改 */
  note: string
  when: (row: any) => boolean
}

export const COLUMN_NOTE_RULES: Record<string, ColumnNoteRule[]> = {
  om_factors: [
    {
      column: 'value',
      badge: '系统算',
      note: '取值由同组的成员行推导、引擎现算，不能直接改。要改结果，请改本组里参与计算的那些行。',
      when: (r) => isComputedCalc(r?.calc),
    },
  ],
  om_quota_items: [
    {
      column: 'quota',
      badge: '留档',
      note: '该条目写了「计算式」，实际取值由后台参数现算 —— 改这一格不会生效（要改就点「编辑」改计算式）。',
      when: (r) => !!(r?.formula && String(r.formula).trim()),
    },
  ],
}

export function columnNote(table: string, row: any, column: string): ColumnNoteRule | null {
  for (const r of COLUMN_NOTE_RULES[table] || []) {
    if (r.column === column && r.when(row)) return r
  }
  return null
}
