/**
 * 汇总站重算 —— 纯函数核心
 *
 * 背景：各管理处把「全站设备汇总」当成一行存进了大表，它本是台账里的「子站合计」。
 * 但它一次性写死，明细改动后不会跟着变（截图里保定的「对照 212」就是这份陈旧快照）。
 *
 * 改造后：汇总站不再是「写死的一行」，而是「真正把本处其它子站的全部设备按同款累加」的结果。
 * 重算 = 把汇总站的 station_devices 按明细子站的累加结果重建（只动 qty，单价仍取设备主数据那唯一一份）。
 *
 * 本文件只做纯计算，不碰数据库 —— 便于单测与复用（脚本 / API 都用它）。
 */

// ⚠️ 必须 import 而不能只用 `export { X } from './deviceSeed'`：
//    后者只是转发导出，**本模块作用域里并没有这两个绑定**，
//    isRecalcableSummaryStation() 里引用它们会直接 ReferenceError。
import { SUMMARY_SUBSITE, NOT_SUMMARY_STATIONS } from './deviceSeed'
export { SUMMARY_SUBSITE, NOT_SUMMARY_STATIONS }

/** 同款累加的身份键：分类+子分类+名称+品牌型号+单位+单价 全同才合并 */
export type MergeKeyInput = {
  category?: string | null
  subcategory?: string | null
  name: string
  brand_model?: string | null
  unit?: string | null
  unit_price?: number | null
}

export type DetailRow = MergeKeyInput & {
  /** 明细所在子站（用于排除汇总站自己，并给出覆盖统计） */
  subsite: string
  qty?: number | null
  device_id: number
}

export type MergedRow = MergeKeyInput & {
  /** 累加后的数量；参与合并的所有行 qty 均为 null 时保持 null */
  qty: number | null
  /** 来源明细子站名单（去重、升序），用于报告「这一项是从哪些站汇总来的」 */
  fromSubsites: string[]
  /** 有明细的 device_id：单价由设备主数据唯一决定，同一合并键只可能对应一个设备（同键含单价） */
  device_id: number
}

/** 合并键：与 deviceSeed.ts 的 deviceKey 同口径（含单价），保证「同款」= 同一条设备主数据 */
export function mergeKey(r: MergeKeyInput): string {
  return JSON.stringify([
    r.category ?? '',
    r.subcategory ?? '',
    r.name ?? '',
    r.brand_model ?? '',
    r.unit ?? '',
    r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
  ])
}

/**
 * 把明细行按「同款」累加。
 * - 数量累加：`null` 视为 0 参与加法；但若所有来源行都是 `null`，结果保持 `null`（不把「未填」算成 0）
 * - 单价不参与运算：合并键已含单价，同键必然同价
 * - 输出按键排序（分类→子分类→名称→型号→单位），保证重算结果稳定可比
 */
export function mergeDetailRows(rows: DetailRow[]): MergedRow[] {
  const acc = new Map<string, MergedRow & { sawQty: boolean }>()
  for (const r of rows) {
    const k = mergeKey(r)
    let m = acc.get(k)
    if (!m) {
      m = {
        category: r.category ?? null,
        subcategory: r.subcategory ?? null,
        name: r.name,
        brand_model: r.brand_model ?? null,
        unit: r.unit ?? null,
        unit_price: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
        qty: null,
        fromSubsites: [],
        device_id: r.device_id,
        sawQty: false,
      }
      acc.set(k, m)
    }
    const q = r.qty === null || r.qty === undefined ? null : Number(r.qty)
    if (q !== null) {
      m.qty = (m.qty ?? 0) + q
      m.sawQty = true
    }
    if (!m.fromSubsites.includes(r.subsite)) m.fromSubsites.push(r.subsite)
  }

  const out: MergedRow[] = []
  for (const m of acc.values()) {
    if (!m.sawQty) m.qty = null
    m.fromSubsites.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    const { sawQty: _drop, ...rest } = m
    out.push(rest)
  }
  out.sort(
    (a, b) =>
      (a.category ?? '').localeCompare(b.category ?? '', 'zh-Hans-CN') ||
      (a.subcategory ?? '').localeCompare(b.subcategory ?? '', 'zh-Hans-CN') ||
      a.name.localeCompare(b.name, 'zh-Hans-CN') ||
      (a.brand_model ?? '').localeCompare(b.brand_model ?? '', 'zh-Hans-CN') ||
      (a.unit ?? '').localeCompare(b.unit ?? '', 'zh-Hans-CN') ||
      (a.unit_price ?? 0) - (b.unit_price ?? 0)
  )
  return out
}

/** 单个汇总站的重算计划：要写入哪些行、要清掉哪些行、影响面多大 */
export type RecalcPlan = {
  /** 目标态：汇总站应持有的 (device_id, qty) 行 */
  upserts: Array<{ device_id: number; qty: number | null; fromSubsites: string[] }>
  /** 汇总站现存、但明细里已不存在的 device_id（重算后应移除） */
  removals: number[]
  /** 汇总站现存行中数量会变的行数 */
  changed: number
  /** 汇总站现存行中数量不变的行数 */
  unchanged: number
  /** 因 source='manual' 被保护、不参与重算的行数 */
  protectedManual: number
  /** 覆盖到的明细子站数（不含汇总站自己） */
  coveredSubsites: number
  /** 重算前后的数量合计，用于对账 */
  qtyBefore: number
  qtyAfter: number
}

export type CurrentSummaryRow = {
  device_id: number
  qty: number | null
  source?: string | null
  /** 与设备主数据比对用的同款键（脚本从库里带出来） */
  mergeKey: string
}

/**
 * 计算某个汇总站的重算计划。
 *
 * @param detailRows    本管理处**明细子站**的全部设备行（调用方须已排除汇总站自身）
 * @param currentRows   汇总站当前持有的行（含 source）
 * @param option.includeManual 是否连 `source='manual'` 的行一起重算（默认 false = 保护人工行）
 */
export function planSummaryRecalc(
  detailRows: DetailRow[],
  currentRows: CurrentSummaryRow[],
  option: { includeManual?: boolean } = {}
): RecalcPlan {
  const includeManual = option.includeManual === true
  const merged = mergeDetailRows(detailRows)

  const upserts = merged.map((m) => ({ device_id: m.device_id, qty: m.qty, fromSubsites: m.fromSubsites }))
  const targetIds = new Set(upserts.map((u) => u.device_id))

  const cur = new Map<number, { qty: number | null; manual: boolean; mergeKey: string }>()
  for (const r of currentRows) {
    const manual = (r.source ?? '') === 'manual'
    // 同 device_id 理论上只有一行（uq_sd）；若真有重复，保留非 manual 的那条做判定
    const prev = cur.get(r.device_id)
    if (!prev || (prev.manual && !manual)) cur.set(r.device_id, { qty: r.qty, manual, mergeKey: r.mergeKey })
  }

  const removals: number[] = []
  let changed = 0
  let unchanged = 0
  let protectedManual = 0
  let qtyBefore = 0
  for (const [id, c] of cur) {
    qtyBefore += c.qty ?? 0
    // 被保护的 manual 行：既不删除也不改写
    if (c.manual && !includeManual) {
      if (!targetIds.has(id)) {
        protectedManual++
        continue
      }
      // manual 行恰好也在目标态里 —— 仍然保护，跳过比对
      protectedManual++
      continue
    }
    if (!targetIds.has(id)) {
      removals.push(id)
      continue
    }
    const t = upserts.find((u) => u.device_id === id)!
    if ((t.qty ?? 0) === (c.qty ?? 0)) unchanged++
    else changed++
  }

  let qtyAfter = 0
  for (const u of upserts) qtyAfter += u.qty ?? 0

  const covered = new Set<string>()
  for (const r of detailRows) covered.add(r.subsite)

  return {
    upserts,
    removals: removals.sort((a, b) => a - b),
    changed,
    unchanged,
    protectedManual,
    coveredSubsites: covered.size,
    qtyBefore,
    qtyAfter,
  }
}

/**
 * 汇总站名（保持现名不动）与豁免处名单，均**直接复用 deviceSeed.ts 的常量**：
 * 重算判定与 is_summary 判定必须同源，各写一份会在改动时悄悄分叉
 * （一边排除、一边重算 → 数据打架）。
 * 见文件顶部 import —— 这里不再重复导出。
 */
/**
 * 判断某管理处的「全站设备汇总」是否应当参与重算。
 * 与 deviceSeed.ts 的 is_summary 口径完全一致 —— 两处必须同源，否则一边排除一边重算会打架。
 */
export function isRecalcableSummaryStation(station: string, subsite: string): boolean {
  return subsite.trim() === SUMMARY_SUBSITE && !NOT_SUMMARY_STATIONS.includes(station.trim())
}
