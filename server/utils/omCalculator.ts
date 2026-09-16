// 运维费用测算引擎（双引擎）
//
// c1    —— C.1 工作量法
//          依据 GB/T 28827.7-2022 附录 A 调整因子 +《2025年中国软件行业基准数据》附录 C.1 单位工作量
//          合价 = 数量 × (单位工作量 × 工作量因子) × (人天单价 × 价格因子)
//          （对应源表《参照国标进行测算（结合配套实际）.xlsx》各站点 sheet 的 K 列公式）
//
// quota —— 定额单价法
//          依据 2008 年行业维护定额（工资涨幅 3.47822 已内含于定额值）
//          年运维费 = 数量 × 定额值(元/月) × 12 × 类别系数(硬件/软件)
//          （对应源表《设备台账__数据对齐版v2_0913.xlsx》的运维费合价列）
//
// ⚠️ 本文件刻意不写死任何常数：全部系数、费率、基准值都从
//    om_wage_base / om_factors / om_rate_items / om_c1_benchmarks / om_quota_items /
//    om_station_types 六张表读取，后台改完即生效。
//    lookup 用的「名称」都是后台可见、可改的中文名，改名前请同步此处常量。

import db from './db'

export type OmEngine = 'c1' | 'quota'

export interface OmWageRow {
  id: number; year: number | null; region: string | null; industry: string | null
  monthly_wage: number; work_days: number; is_default: boolean
  /** 用途：c1 = C.1工作量法锚点 / quota = 定额法锚点 / ref = 仅参考 */
  usage: string | null
  source: string | null; note: string | null
}
export interface OmFactorRow {
  id: number; group_key: string; group_name: string | null; engine: string
  name: string; value: number; unit: string; calc: string
  /** 加权项（calc='weight_item'）在加权平均里的权重；其余行恒为 1 */
  weight?: number
  description: string | null; basis: string | null; seq: number
}
export interface OmRateRow {
  id: number; group_key: string; group_name: string | null
  /** 适用引擎：c1 / quota（两法尾部费用结构不同） */
  engine: string
  name: string
  rate: number; unit: string; base_note: string | null; description: string | null; seq: number
}
export interface OmC1Row {
  id: number; category: string; level: string | null; unit: string
  workload: number; source: string | null; note: string | null; seq: number
}
export interface OmQuotaRow {
  id: number; name: string; unit: string; quota: number; kind: string
  /** 是否按功能点（点位数）计价：软件类条目需再乘点位数 */
  point_based: boolean | null
  /** 变量化推导式（空 = 直接用 quota 固定值） */
  formula: string | null
  /** 源表原始 Excel 公式（追溯用） */
  formula_raw: string | null
  /** 推导式的中文说明（只给人和追溯面板看，不参与计算） */
  formula_text: string | null
  source: string | null; note: string | null; seq: number
}
export interface OmStationRow {
  id: number; code: string; name: string; unit: string; qty: number
  time_factor: number; sheet_name: string | null; sort: number
}

export interface OmParams {
  wageBases: OmWageRow[]
  wage: OmWageRow | undefined
  /** 人天单价 = 月均工资 ÷ 月计薪天数 */
  dailyRate: number
  /** 定额法专用工资锚点（usage='quota'），用于现算定额表中的 month_wage 类公式 */
  quotaWage: OmWageRow | undefined
  factors: OmFactorRow[]
  rates: OmRateRow[]
  c1: OmC1Row[]
  quota: OmQuotaRow[]
  stations: OmStationRow[]
  /** 定额推导式变量表（month_wage / fp_coef / wage_ratio / months） */
  quotaVars: Record<string, number>
}

export interface OmItemInput {
  name: string
  station?: string
  category?: string
  sheet_no?: number | null
  unit?: string
  qty: number
  /** c1 引擎：C.1 设备类别（对应 om_c1_benchmarks.category） */
  category_ref?: string
  /** c1 引擎：单位工作量覆盖值（留空则按 category_ref 查基准） */
  workload?: number | null
  /** quota 引擎：定额条目名（对应 om_quota_items.name） */
  quota_ref?: string
  /** quota 引擎：定额值覆盖值 */
  quota_value?: number | null
  /** quota 引擎：硬件 / 软件（留空则以定额库中该条目的类别为准） */
  kind?: string
  /** quota 引擎：点位数（按功能点计价的条目必填，如 PLC应用系统 / UNITY PRO） */
  point_count?: number | null
  /** 明确不计费（线缆/机柜/家具等）：金额按 0 计，且不算「未匹配」 */
  billable?: boolean
  note?: string
}

export interface OmItemResult extends OmItemInput {
  /** 实际采用的单位工作量（c1） */
  usedWorkload: number
  /** 实际采用的定额值（quota） */
  usedQuota: number
  /** 修正工作量 = 单位工作量 × 工作量因子（c1） */
  correctedWorkload: number
  /** 修正单价 = 人天单价 × 价格因子（c1） */
  correctedPrice: number
  /** 类别系数（quota） */
  kindCoef: number
  /** 定额值是否为变量化推导式现算（quota） */
  quotaByFormula?: boolean
  /** 实际参与计算的点位数（quota，按功能点计价的条目） */
  usedPointCount?: number
  stationTimeFactor: number
  amount: number
  resolved: boolean
  warn?: string
}

export interface OmCostLine {
  key: string
  label: string
  /** 计费基数说明 */
  base: string
  rate: number
  unit: string
  amount: number
}

export interface OmResult {
  engine: OmEngine
  items: OmItemResult[]
  /** 人工费（c1）/ 直接运维费（quota）—— 明细合价之和 */
  laborCost: number
  /** 明细合计的人天（c1 才有意义；quota 引擎按定额倒推不来，返回 0） */
  totalPersonDays: number
  otherDirect: OmCostLine[]
  otherDirectTotal: number
  /** 运行维护管理服务费（源表附表5，= 直接费小计 × 费率；未启用时为 null） */
  mgmtService: OmCostLine | null
  /** 直接费小计（人工费 + 其他直接费，未含管理服务费） */
  directSubtotal: number
  directTotal: number
  indirect: OmCostLine[]
  indirectTotal: number
  pretax: number
  tax: OmCostLine | null
  spare: OmCostLine | null
  /** 以其他费用项为基数的费用（如定额法暂列金，基数是备品备件） */
  extra: OmCostLine[]
  extraTotal: number
  total: number
  meta: {
    wageBaseLabel: string
    dailyRate: number
    workloadFactor: number
    /** 服务周期 × 服务频率 × 生存周期（不含人员配备、不含站点服务时间） */
    basePriceFactor: number
    /** 人员配备系数（等级加权） */
    staffCoef: number
    /** 生效价格因子 = 人员配备系数 × basePriceFactor（站点行再乘各站服务时间系数） */
    priceFactor: number
    hardCoef: number
    softCoef: number
    monthFactor: number
    engineLabel: string
    /** 定额推导式变量表（month_wage / fp_coef / wage_ratio / months） */
    quotaVars: Record<string, number>
  }
}

// ── 参数装载 ──────────────────────────────────────────────────
export async function loadOmParams(wageBaseId?: number | null): Promise<OmParams> {
  const wageBases = (await db
    .prepare('SELECT * FROM om_wage_base ORDER BY is_default DESC, id')
    .all()) as OmWageRow[]
  const factors = (await db
    .prepare('SELECT * FROM om_factors WHERE is_active = true ORDER BY group_key, seq, id')
    .all()) as OmFactorRow[]
  const rates = (await db
    .prepare('SELECT * FROM om_rate_items WHERE is_active = true ORDER BY group_key, seq, id')
    .all()) as OmRateRow[]
  const c1 = (await db
    .prepare('SELECT * FROM om_c1_benchmarks WHERE is_active = true ORDER BY seq, id')
    .all()) as OmC1Row[]
  const quota = (await db
    .prepare('SELECT * FROM om_quota_items WHERE is_active = true ORDER BY seq, id')
    .all()) as OmQuotaRow[]
  const stations = (await db
    .prepare('SELECT * FROM om_station_types WHERE is_active = true ORDER BY sort, id')
    .all()) as OmStationRow[]

  const wage =
    (wageBaseId != null ? wageBases.find((w) => Number(w.id) === Number(wageBaseId)) : undefined) ||
    wageBases.find((w) => w.is_default) ||
    wageBases[0]
  const days = wage ? Number(wage.work_days) || 21.75 : 21.75
  const dailyRate = wage ? Number(wage.monthly_wage) / days : 0

  // 定额法有自己的工资锚点（源表定额!D3 = 136833/12 = 11402.75，与 C.1 法的 11436.9167 不同）
  const quotaWage = wageBases.find((w) => w.usage === 'quota') || wage

  // 定额推导式变量表：全部取自后台可维护的参数，改参数 → 定额值联动。
  // 这几个变量是「按名取用」的，**名称就是接口** —— 找不到必须报错，不能静默回退默认值，
  // 否则后台改个名就会让全区几千条定额值悄悄变形（且没有任何提示）。
  const named = (name: string): number => {
    const f = factors.find((x) => x.group_key === 'quota_global' && x.name === name)
    if (!f) {
      throw new Error(
        `[运维测算] 参数缺失：定额法全局系数里没有名为「${name}」的因子。` +
        `该行按名称取用（后台标注「按名取用·勿改名」），改名或删除会让定额值失真，故直接中止。` +
        `请到「数据维护 → 运维参数 → 调整因子 → 定额法全局系数」恢复该名称。`
      )
    }
    return Number(f.value)
  }
  const quotaVars: Record<string, number> = {
    month_wage: quotaWage ? Number(quotaWage.monthly_wage) : 0,
    fp_coef: named('功能点调整系数'),
    wage_ratio: named('运维单价调整系数'),
    months: named('年·月换算系数'),
  }

  return { wageBases, wage, dailyRate, quotaWage, factors, rates, c1, quota, stations, quotaVars }
}

/**
 * 安全表达式求值：只接受 数字 / 变量名 / + - * / ( )，
 * 先做词法切分再递归下降解析，**不使用 eval / new Function**。
 * 出现非法字符、未知变量、除零或结果非有限数时返回 null（调用方回退到固定值）。
 */
export function evalExpr(expr: string, vars: Record<string, number>): number | null {
  const src = String(expr || '').replace(/\s+/g, '')
  if (!src) return null
  const tokens = src.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()]/g)
  // 切分后必须能拼回原串，否则说明含被静默跳过的非法字符
  if (!tokens || tokens.join('') !== src) return null

  let i = 0
  const peek = () => tokens[i]
  function primary(): number {
    const t = peek()
    if (t === undefined) throw new Error('表达式意外结束')
    if (t === '(') { i++; const v = exprAdd(); if (peek() !== ')') throw new Error('括号不匹配'); i++; return v }
    if (t === '+') { i++; return primary() }
    if (t === '-') { i++; return -primary() }
    if (/^\d/.test(t)) { i++; return Number(t) }
    i++
    if (!(t in vars)) throw new Error(`未知变量 ${t}`)
    return Number(vars[t])
  }
  function exprMul(): number {
    let v = primary()
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++]
      const r = primary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function exprAdd(): number {
    let v = exprMul()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++]
      const r = exprMul()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  try {
    const v = exprAdd()
    if (i !== tokens.length) return null
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** 定额值：优先按变量化推导式现算，失败或无公式则回退到库里存的固定值 */
export function quotaValueOf(q: OmQuotaRow, vars: Record<string, number>): number {
  if (q.formula) {
    const v = evalExpr(q.formula, vars)
    if (v != null) return v
  }
  return Number(q.quota)
}

/**
 * 按名取用因子（calc='named'）：引擎不按 calc 走，而是按 group_key + name 精确定位。
 *
 * ⚠️ 找不到时**必须报错**，不能回退默认值。2026-09-16 之前这里默认 1 / 12：
 * 只要有人在后台把「硬件取费调整系数」改个名（或删掉那一行），定额法就静默少乘 1.917 倍，
 * 金额悄悄错掉近一半而界面上一切正常、毫无提示 —— 这是最危险的一类 bug。
 * 现在改成当场中止并说明去哪里改回来：宁可让测算失败，也不给一个错的数。
 */
function requireNamedFactor(p: OmParams, groupKey: string, name: string): number {
  const f = p.factors.find((x) => x.group_key === groupKey && x.name === name)
  if (!f) {
    throw new Error(
      `[运维测算] 参数缺失：${groupKey} 组里没有名为「${name}」的因子。` +
      `该行是引擎按名称取用的（后台「计算方式」列标注为「按名取用·勿改名」），` +
      `改名或删除会让测算结果失真，故直接中止。` +
      `请到「数据维护 → 运维参数 → 调整因子」把名称恢复成「${name}」。`
    )
  }
  return Number(f.value)
}

/** 组内所有 calc='multiply' 的因子连乘
 *  （'weight_item' 加权项 / 'named' 按名取用 / 'option' 备选 / 'listed' 源表已列未进公式 / 结果行 一律排除） */
function groupProduct(p: OmParams, groupKey: string): number {
  return p.factors
    .filter((f) => f.group_key === groupKey && f.calc === 'multiply')
    .reduce((a, f) => a * Number(f.value), 1)
}

/**
 * 组内 calc='weight_item' 的因子按 weight 加权平均：Σ(取值 × 权重) ÷ Σ权重。
 * 返回 null 表示该组里没有加权项（老库尚未升级到 v5）→ 调用方回退读存量的结果行。
 * 与 db.ts 的 recomputeComputedFactors() 同一口径（那边回填存量，这边现算）。
 */
export function weightedGroupValue(p: OmParams, groupKey: string): number | null {
  const ms = p.factors.filter((f) => f.group_key === groupKey && f.calc === 'weight_item')
  if (!ms.length) return null
  const wSum = ms.reduce((a, f) => a + Number(f.weight ?? 1), 0)
  if (!(wSum > 0)) return null
  const v = ms.reduce((a, f) => a + Number(f.value) * Number(f.weight ?? 1), 0) / wSum
  return Number.isFinite(v) ? v : null
}

/** 本批测算实际采用的全局因子（两法各自的那几个乘数） */
export interface OmGlobalFactors {
  /** C.1 工作量调整因子 F = 失效率 × 离散程度 × 复杂程度 */
  workloadFactor: number
  /** C.1 服务级别因子 = 服务周期 × 服务频率 × 服务对象生存周期 */
  basePriceFactor: number
  /** C.1 人员配备系数（加权） */
  staffCoef: number
  /** 定额法 硬件取费调整系数 */
  hardCoef: number
  /** 定额法 软件取费调整系数 */
  softCoef: number
  /** 年·月换算系数 */
  monthFactor: number
  /** 人天单价 = 月工资基数 ÷ 月计薪天数 */
  dailyRate: number
}

/**
 * 全局因子取值的**单一来源**：`calcOm` 与 `traceOmRow`（单行追溯）都调用它。
 * 追溯链上的每个乘数与被追溯的金额由此必然同源 —— 不可能出现
 * 「追溯面板显示的系数」与「实际算钱用的系数」不一致的情况。
 */
export function deriveOmFactors(p: OmParams): OmGlobalFactors {
  // 人员配备系数：优先由 5 个等级行 × 权重 **现算**（改等级系数或改权重即自动联动）；
  // 老库还没升级到 v5 时组内没有加权项，回退读那行存量结果（同样找不到就报错，不静默给 1）。
  const staffCoef =
    weightedGroupValue(p, 'c1_staff') ?? requireNamedFactor(p, 'c1_staff', '人员配备系数（加权）')
  return {
    workloadFactor: groupProduct(p, 'c1_workload'),
    basePriceFactor: groupProduct(p, 'c1_price'),
    staffCoef,
    hardCoef: requireNamedFactor(p, 'quota_global', '硬件取费调整系数'),
    softCoef: requireNamedFactor(p, 'quota_global', '软件取费调整系数'),
    monthFactor: requireNamedFactor(p, 'quota_global', '年·月换算系数'),
    dailyRate: p.dailyRate,
  }
}

/** 某个因子分组里真正参与连乘的因子（追溯时逐个列出，如 失效率1.2 × 离散1.8 × 复杂1.0）
 *  过滤条件必须与 groupProduct 完全一致，否则追溯链会列出「实际没乘」的行。 */
export function factorBreakdown(p: OmParams, groupKey: string): Array<{ name: string; value: number; basis: string | null }> {
  return p.factors
    .filter((f) => f.group_key === groupKey && f.calc === 'multiply')
    .map((f) => ({ name: f.name, value: Number(f.value), basis: f.basis }))
}

// ⚠️ 性能关键：归一化名缓存。
// normName 是**纯函数**，但在一次大清单测算里会被调用上百万次
// （349 条定额 × 每行最多 4 轮探测；设备库里同名设备会重复出现几十次）。
// 不缓存的话定额法 3000 行要 ~385ms、8452 行要 ~1042ms，最坏（全部未命中）近 4 秒。
const NORM_CACHE = new Map<string, string>()
const NORM_CACHE_MAX = 20000

function normName(s: string | null | undefined): string {
  const raw = String(s == null ? '' : s)
  const hit = NORM_CACHE.get(raw)
  if (hit !== undefined) return hit
  const out = raw.replace(/[\s（）()·・,，、]/g, '').toLowerCase()
  // 简单的容量保护：超限整个清空（本场景键集合很小，重建可忽略）
  if (NORM_CACHE.size >= NORM_CACHE_MAX) NORM_CACHE.clear()
  NORM_CACHE.set(raw, out)
  return out
}

/** 模糊查 C.1 基准行：先精确、再去掉「借」前缀、再归一化包含匹配 */
export function findC1Row(c1: OmC1Row[], raw: string): OmC1Row | null {
  const hit = c1.find((x) => x.category === raw)
  if (hit) return hit
  const stripped = raw.replace(/^借/, '')
  const hit2 = c1.find((x) => x.category === stripped)
  if (hit2) return hit2
  const n = normName(stripped)
  const hit3 =
    c1.find((x) => normName(x.category).replace(/^借/, '') === n) ||
    c1.find((x) => normName(x.category).replace(/^借/, '').includes(n)) ||
    c1.find((x) => n.includes(normName(x.category).replace(/^借/, '')))
  return hit3 || null
}

/** C.1 基准查值的**唯一实现**：先精确定位到行，再取该行的人天值 */
function lookupC1Raw(c1: OmC1Row[], raw: string): number | null {
  const row = findC1Row(c1, raw)
  return row ? Number(row.workload) : null
}

/**
 * @param cache 同一批测算内复用查找结果（键 = ref 原文）。**必须每次测算新建一个**，
 *              因为参数表可能在两次测算之间被后台改过。不传则退化为纯函数。
 */
export function lookupC1(
  c1: OmC1Row[],
  ref?: string | null,
  cache?: Map<string, number | null>
): number | null {
  if (!ref) return null
  const raw = String(ref).trim()
  if (!raw) return null
  if (cache) {
    const hit = cache.get(raw)
    if (hit !== undefined) return hit
  }
  const val = lookupC1Raw(c1, raw)
  if (cache) cache.set(raw, val)
  return val
}

/** 模糊查定额：先精确，再归一化包含匹配 */
function lookupQuotaRaw(quota: OmQuotaRow[], raw: string): OmQuotaRow | null {
  const hit = quota.find((x) => x.name === raw)
  if (hit) return hit
  const n = normName(raw)
  return (
    quota.find((x) => normName(x.name) === n) ||
    quota.find((x) => n.length >= 4 && normName(x.name).includes(n)) ||
    quota.find((x) => normName(x.name).length >= 4 && n.includes(normName(x.name))) ||
    null
  )
}

/** @param cache 同 lookupC1：键 = ref 原文，每次测算新建 */
export function lookupQuota(
  quota: OmQuotaRow[],
  ref?: string | null,
  cache?: Map<string, OmQuotaRow | null>
): OmQuotaRow | null {
  if (!ref) return null
  const raw = String(ref).trim()
  if (!raw) return null
  if (cache) {
    const hit = cache.get(raw)
    if (hit !== undefined) return hit
  }
  const val = lookupQuotaRaw(quota, raw)
  if (cache) cache.set(raw, val)
  return val
}

function findStation(stations: OmStationRow[], it: OmItemInput): OmStationRow | undefined {
  const key = it.station || it.station_code
  if (!key) return undefined
  // 站点名三种写法都要认：显示名 / 编码 / 源测算书的工作表名
  // （示例清单来自源表，「管理处」实际对应站点类型「管理处监控中心」）
  return stations.find((s) => s.name === key || s.code === key || s.sheet_name === key)
}

// ── 费率基数解析（由后台「计费基数」文字决定，可改）────────────────
interface TailCtx {
  labor: number
  direct: number
  overhead: number
  pretax: number
  personDays: number
  tax: number
  spare: number
}

function resolveBase(baseNote: string | null | undefined, ctx: TailCtx): { label: string; value: number } {
  const s = String(baseNote || '')
  // ⚠️ 组合基数必须先判：否则「间接费+直接费」会被后面的「直接费」抢先命中，
  //    少算一个间接费（源表 F17/F18 = 费率×(F15+F4) 就是这个组合）
  if (s.includes('间接费') && s.includes('直接费')) {
    return { label: '间接费+直接费', value: ctx.direct + ctx.overhead }
  }
  if (s.includes('直接费') && s.includes('税金')) {
    return { label: '直接费+税金', value: ctx.direct + ctx.tax }
  }
  if (s.includes('备品备件')) return { label: '备品备件', value: ctx.spare }
  if (s.includes('税前')) return { label: '税前造价', value: ctx.pretax }
  if (s.includes('直接费')) return { label: '直接费', value: ctx.direct }
  if (s.includes('人天') || s.includes('天')) return { label: '人天', value: ctx.personDays }
  return { label: '人工费', value: ctx.labor }
}

/** 取某费用组在当前引擎下启用的费率项（engine 不匹配的跳过：两法尾部结构不同） */
function sumGroup(
  p: OmParams,
  groupKey: string,
  ctx: TailCtx,
  engine: OmEngine,
  skipYuan = false
): OmCostLine[] {
  return p.rates
    .filter((r) => r.group_key === groupKey && (r.engine === engine || r.engine === 'both'))
    .map((r) => {
      const isYuan = r.unit === 'yuan'
      if (isYuan && skipYuan) return null
      const base = isYuan ? { label: '人天', value: ctx.personDays } : resolveBase(r.base_note, ctx)
      return {
        key: `${groupKey}:${r.id}`,
        label: r.name,
        base: base.label,
        rate: Number(r.rate),
        unit: r.unit,
        amount: Number(r.rate) * base.value,
      } as OmCostLine
    })
    .filter((x): x is OmCostLine => !!x)
}

export interface OmCalcOptions {
  /**
   * 运行维护管理服务费率（源表附表5）。传 null/0 表示不叠加。
   * 取值来自 om_rate_items 的 mgmt_service 组，默认 0.10。
   */
  mgmtServiceRate?: number | null
}

// ── 主计算 ────────────────────────────────────────────────────
export function calcOm(
  engine: OmEngine,
  items: OmItemInput[],
  p: OmParams,
  opts: OmCalcOptions = {}
): OmResult {
  const f = deriveOmFactors(p)
  const workloadFactor = f.workloadFactor
  const basePriceFactor = f.basePriceFactor
  const staffCoef = f.staffCoef
  const hardCoef = f.hardCoef
  const softCoef = f.softCoef
  const monthFactor = f.monthFactor
  const dailyRate = f.dailyRate

  const results: OmItemResult[] = []
  let laborCost = 0
  let totalPersonDays = 0

  // 本批测算专用的查找缓存：设备库同一设备名会重复出现几十次，
  // 缓存后 8452 行走一次全表探测即可（定额法 1042ms → 数十 ms 量级）。
  const c1Cache = new Map<string, number | null>()
  const quotaCache = new Map<string, OmQuotaRow | null>()

  for (const it of items) {
    const qty = Number(it.qty) || 0
    const st = findStation(p.stations, it)
    const stationTimeFactor = st ? Number(st.time_factor) || 1 : 1

    // 明确不计费的行（结构件/线缆/机柜/家具等）：金额为 0，不当成「未匹配」报错
    if (it.billable === false) {
      results.push({
        ...it, usedWorkload: 0, usedQuota: 0, correctedWorkload: 0, correctedPrice: 0,
        kindCoef: 0, stationTimeFactor, amount: 0, resolved: true,
      })
      continue
    }

    if (engine === 'c1') {
      let used: number
      let resolved = true
      let warn: string | undefined
      if (it.workload != null && it.workload !== ('' as any)) {
        used = Number(it.workload) || 0
      } else {
        const v = lookupC1(p.c1, it.category_ref, c1Cache)
        if (v == null) {
          used = 0
          resolved = false
          warn = `未匹配到 C.1 类别「${it.category_ref || '（未填）'}」，本行按 0 计`
        } else used = v
      }
      // 价格因子 = 人员配备系数 × (服务周期 × 服务频率 × 生存周期) × 站点服务时间系数
      const priceFactor = staffCoef * basePriceFactor * stationTimeFactor
      const correctedWorkload = used * workloadFactor
      const correctedPrice = dailyRate * priceFactor
      const amount = qty * correctedWorkload * correctedPrice
      laborCost += amount
      totalPersonDays += qty * correctedWorkload
      results.push({
        ...it, usedWorkload: used, usedQuota: 0, correctedWorkload, correctedPrice,
        kindCoef: 0, stationTimeFactor, amount, resolved, warn,
      })
    } else {
      let qRow: OmQuotaRow | null = null
      let used: number
      let resolved = true
      let warn: string | undefined
      let byFormula = false
      qRow = lookupQuota(p.quota, it.quota_ref, quotaCache)
      if (it.quota_value != null && it.quota_value !== ('' as any)) {
        used = Number(it.quota_value) || 0
      } else if (!qRow) {
        used = 0
        resolved = false
        warn = `未匹配到定额条目「${it.quota_ref || '（未填）'}」，本行按 0 计`
      } else {
        // 定额值优先按变量化推导式现算（改后台工资/系数即联动），失败则回退固定值
        used = quotaValueOf(qRow, p.quotaVars)
        byFormula = !!(qRow.formula && evalExpr(qRow.formula, p.quotaVars) != null)
        if (!used) warn = `定额条目「${qRow.name}」在源表中定额值为空，本行按 0 计`
      }
      // 类别以「定额库中该条目的 kind」为准：源表 7,851 条 J 列公式反查确认，
      // 名字里带"软件"的站控应用系统等实际走硬件系数，只有 PLC应用系统 / UNITY PRO 走软件系数
      const kind = qRow?.kind || it.kind || '硬件'
      const kindCoef = kind === '软件' ? softCoef : hardCoef
      // 按功能点计价的条目必须再乘点位数（源表 J = I×E×G16×点位数×12）
      const pointBased = qRow?.point_based === true
      const ptCount = pointBased ? Number(it.point_count) || 0 : 0
      if (pointBased && ptCount <= 0) {
        resolved = false
        warn = `「${qRow?.name}」按功能点计价，需填写点位数；未填则本行按 0 计`
      }
      const amount = qty * used * monthFactor * kindCoef * (pointBased ? ptCount : 1)
      laborCost += amount
      results.push({
        ...it, usedWorkload: 0, usedQuota: used, correctedWorkload: 0, correctedPrice: 0,
        kindCoef, stationTimeFactor, amount, resolved, warn,
        quotaByFormula: byFormula, usedPointCount: pointBased ? ptCount : undefined,
      })
    }
  }

  // 其他直接费：规费 / 直接非人力成本 / 措施项目费（基数按后台「计费基数」文字判定）
  const ctx: TailCtx = {
    labor: laborCost, direct: 0, overhead: 0, pretax: 0,
    personDays: totalPersonDays, tax: 0, spare: 0,
  }
  const otherDirect = [
    ...sumGroup(p, 'regulation', ctx, engine),
    ...sumGroup(p, 'nonlabor', ctx, engine),
    ...sumGroup(p, 'measure', ctx, engine),
  ]
  const otherDirectTotal = otherDirect.reduce((a, l) => a + l.amount, 0)
  const directSubtotal = laborCost + otherDirectTotal

  // 运行维护管理服务费（源表附表5）：以「直接费小计」为基数
  const mgmtRate = Number(opts.mgmtServiceRate || 0)
  const mgmtService: OmCostLine | null =
    mgmtRate > 0
      ? {
          key: 'mgmt_service',
          label: '运行维护管理服务费',
          base: '直接费小计',
          rate: mgmtRate,
          unit: 'ratio',
          amount: directSubtotal * mgmtRate,
        }
      : null
  const directTotal = directSubtotal + (mgmtService?.amount || 0)

  ctx.direct = directTotal

  // 间接费（企业管理费）：源表基数是「直接费」（F16 = 0.12×F4）——
  // 先算出来写进 ctx，供后面利润/税金的「间接费+直接费」组合基数取用
  const overhead = sumGroup(p, 'overhead', ctx, engine)
  ctx.overhead = overhead.reduce((a, l) => a + l.amount, 0)

  // 利润：源表基数是「间接费+直接费」（F17 = D17×(F15+F4)）
  const profit = sumGroup(p, 'profit', ctx, engine)
  const indirect = [...overhead, ...profit]
  const indirectTotal = indirect.reduce((a, l) => a + l.amount, 0)
  const pretax = directTotal + indirectTotal

  ctx.pretax = pretax
  const taxLines = sumGroup(p, 'tax', ctx, engine)
  const tax = taxLines[0] || null
  ctx.tax = tax?.amount || 0
  const spareLines = sumGroup(p, 'spare', ctx, engine)
  const spare = spareLines[0] || null
  ctx.spare = spare?.amount || 0
  // 以其他费用项为基数的费用（如定额法暂列金，源表基数是备品备件）
  const extra = sumGroup(p, 'provisional', ctx, engine)
  const extraTotal = extra.reduce((a, l) => a + l.amount, 0)

  const total = pretax + (tax?.amount || 0) + (spare?.amount || 0) + extraTotal

  const ENGINE_LABEL: Record<OmEngine, string> = { c1: 'C.1 工作量法', quota: '定额单价法' }
  const wageLabel = p.wage
    ? `${p.wage.year || ''}年 ${p.wage.region || ''} ${p.wage.industry || ''} ${Number(p.wage.monthly_wage).toFixed(2)} 元/月 ÷ ${p.wage.work_days} 天`
    : '（未配置人工成本基数）'

  return {
    engine,
    items: results,
    laborCost,
    totalPersonDays,
    otherDirect,
    otherDirectTotal,
    mgmtService,
    directSubtotal,
    directTotal,
    indirect,
    indirectTotal,
    pretax,
    tax,
    spare,
    extra,
    extraTotal,
    total,
    meta: {
      wageBaseLabel: wageLabel,
      dailyRate,
      workloadFactor,
      basePriceFactor,
      staffCoef,
      priceFactor: staffCoef * basePriceFactor,
      hardCoef,
      softCoef,
      monthFactor,
      engineLabel: ENGINE_LABEL[engine],
      quotaVars: p.quotaVars,
    },
  }
}
