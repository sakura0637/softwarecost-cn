import db from './db'
import { loadOmParams, calcOm, type OmEngine, type OmItemInput, type OmParams, type OmResult } from './omCalculator'

// 历史测算的「可复现」能力。
//
// 背景：参数表是**覆盖式修改**的（改工资基数、改费率、停用某条费率项），事后再也回不到当时那套参数。
// 于是同一份清单在不同时间会算出不同金额，对账时无法自证「我们这个数是怎么来的」。
//
// 做法：保存测算时，把**当时生效的整套参数**（loadOmParams 的输出，与算钱用的是同一份）
// 连同清单一起快照进存档。复现时：
//   ① 用**快照参数**重算 → 必须与存档金额完全一致（证明引擎是确定性的、存档没被改坏）
//   ② 再用**当前参数**重算 → 给出差额，回答「今天再算一次会差多少、是哪个参数造成的」
// ②正是对账时最常被问的问题，而它只有在有①的前提下才有意义。

export interface OmParamSnapshot {
  version: 1
  takenAt: string
  /** 各参数表行数：用于快速判断快照是否完整（参数表少了一批行 = 快照可疑） */
  counts: Record<string, number>
  params: OmParams
}

/** 取当前参数快照。刻意复用 loadOmParams —— 快照里必须是「实际算钱用的那一套」，不是另取一份。 */
export async function takeOmSnapshot(wageBaseId?: number | null): Promise<OmParamSnapshot> {
  const params = await loadOmParams(wageBaseId ?? null)
  return {
    version: 1,
    takenAt: new Date().toISOString(),
    counts: {
      wageBases: params.wageBases.length,
      factors: params.factors.length,
      rates: params.rates.length,
      c1: params.c1.length,
      quota: params.quota.length,
      stations: params.stations.length,
    },
    params,
  }
}

function parseJson(v: any): any {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

// ── 参数差异（回答「是哪个参数让金额变了」）──────────────────────
export interface ParamChange {
  table: string
  tableLabel: string
  key: string
  /** added / removed / changed */
  type: 'added' | 'removed' | 'changed'
  field?: string
  label?: string
  old?: any
  new?: any
}

const DIFF_SPEC: Array<{
  table: string
  tableLabel: string
  pick: (p: OmParams) => any[]
  key: (r: any) => string
  fields: Array<[string, string]>
}> = [
  {
    table: 'om_wage_base', tableLabel: '人工成本基数',
    pick: (p) => p.wageBases,
    key: (r) => `${r.usage || ''}|${r.year ?? ''}|${r.industry || ''}`,
    fields: [['monthly_wage', '月工资(元)'], ['work_days', '月计薪天数'], ['usage', '用途'], ['source', '出处']],
  },
  {
    table: 'om_factors', tableLabel: '调整因子',
    pick: (p) => p.factors,
    key: (r) => `${r.group_key}|${r.name}`,
    fields: [['value', '取值'], ['calc', '计算方式'], ['engine', '适用引擎']],
  },
  {
    // ⚠️ loadOmParams 已按 is_active 过滤：停用一条费率项在差异里表现为「删除」，
    //    这正是我们想要的说法 —— 它确实不再参与计算了。
    table: 'om_rate_items', tableLabel: '费率项',
    pick: (p) => p.rates,
    key: (r) => `${r.group_key}|${r.name}|${r.engine}`,
    fields: [['rate', '费率'], ['base_note', '计费基数'], ['unit', '单位']],
  },
  {
    table: 'om_c1_benchmarks', tableLabel: 'C.1 单位工作量基准',
    pick: (p) => p.c1,
    key: (r) => String(r.category),
    fields: [['workload', '单位工作量'], ['level', '级别'], ['source', '出处']],
  },
  {
    table: 'om_quota_items', tableLabel: '定额单价库',
    pick: (p) => p.quota,
    key: (r) => String(r.name),
    fields: [['quota', '库中定额值'], ['formula', '推导式'], ['kind', '类别'], ['point_based', '按点位数计价']],
  },
  {
    table: 'om_station_types', tableLabel: '站点类型',
    pick: (p) => p.stations,
    key: (r) => String(r.code),
    fields: [['time_factor', '服务时间系数'], ['qty', '数量'], ['name', '名称']],
  },
]

/** 比较两套参数，列出差异。limit 只截断返回列表，total 仍是完整计数。 */
export function diffParams(oldP: OmParams, newP: OmParams, limit = 50): { changes: ParamChange[]; total: number } {
  const all: ParamChange[] = []
  for (const spec of DIFF_SPEC) {
    const oldMap = new Map<string, any>()
    for (const r of spec.pick(oldP) || []) oldMap.set(spec.key(r), r)
    const newMap = new Map<string, any>()
    for (const r of spec.pick(newP) || []) newMap.set(spec.key(r), r)

    const keys = new Set([...oldMap.keys(), ...newMap.keys()])
    for (const k of keys) {
      const o = oldMap.get(k)
      const n = newMap.get(k)
      if (o && !n) {
        all.push({ table: spec.table, tableLabel: spec.tableLabel, key: k, type: 'removed' })
      } else if (!o && n) {
        all.push({ table: spec.table, tableLabel: spec.tableLabel, key: k, type: 'added' })
      } else if (o && n) {
        for (const [f, label] of spec.fields) {
          const ov = o[f]
          const nv = n[f]
          // 数值用容差比较，避免 JSON 往返带来的浮点末位差异被当成「改动」
          const same = typeof ov === 'number' && typeof nv === 'number'
            ? Math.abs(ov - nv) < 1e-9
            : JSON.stringify(ov ?? null) === JSON.stringify(nv ?? null)
          if (!same) {
            all.push({ table: spec.table, tableLabel: spec.tableLabel, key: k, type: 'changed', field: f, label, old: ov ?? null, new: nv ?? null })
          }
        }
      }
    }
  }
  return { changes: all.slice(0, limit), total: all.length }
}

// ── 保存存档 ────────────────────────────────────────────────────
export interface SaveArchiveInput {
  name: string
  engine: OmEngine
  wageBaseId: number | null
  mgmtServiceRate: number | null
  items: OmItemInput[]
  sourceLabel?: string | null
  siteLabel?: string | null
  remark?: string | null
  userId: number | null
  operatorName: string | null
}

/**
 * 保存测算存档。
 * 金额由**服务端自己算**（不采信前端传来的数字）—— 存档是要拿去对账的凭证，
 * 里面每个数都必须是本系统算出来的，不能是浏览器算好回填的。
 */
export async function saveOmArchive(input: SaveArchiveInput): Promise<{ id: number; total: number }> {
  const result = calcOm(input.engine, input.items, await loadOmParams(input.wageBaseId), {
    mgmtServiceRate: input.mgmtServiceRate,
  })
  const snapshot = await takeOmSnapshot(input.wageBaseId)
  const unresolvedCount = result.items.filter((x) => !x.resolved).length

  const row: any = await db
    .prepare(
      `INSERT INTO om_projects
        (user_id, name, engine, year, wage_base_id, remark, result_json,
         params_snapshot, items_snapshot, source_label, site_label, mgmt_service_rate,
         item_count, unresolved_count, total_amount, operator_name, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, now(), now())`
    )
    .run(
      input.userId,
      input.name,
      input.engine,
      snapshot.params.wage?.year ?? null,
      input.wageBaseId,
      input.remark ?? null,
      JSON.stringify(result),
      JSON.stringify(snapshot),
      JSON.stringify(input.items),
      input.sourceLabel ?? null,
      input.siteLabel ?? null,
      input.mgmtServiceRate ?? null,
      result.items.length,
      unresolvedCount,
      result.total,
      input.operatorName
    )

  return { id: Number(row.lastID), total: result.total }
}

// ── 复现 ────────────────────────────────────────────────────────
export interface ReproduceResult {
  id: number
  name: string
  engine: OmEngine
  createdAt: string | null
  operatorName: string | null
  itemCount: number
  storedTotal: number
  /** 快照参数重算（应严格等于 storedTotal） */
  snapshotTotal: number
  snapshotLaborCost: number
  /** 与存档金额逐行比对的差异行数（> 0.01 元即计入） */
  snapshotItemDrift: number
  /** 引擎是否确定性复现（金额一致且无逐行漂移） */
  reproducible: boolean
  /** 快照时的参数表行数与关键锚点，便于人工核对快照是否完整 */
  snapshotTakenAt: string | null
  snapshotCounts: Record<string, number> | null
  /** 当前参数重算 —— 回答「今天再算会差多少」 */
  currentTotal: number
  currentLaborCost: number
  currentUnresolved: number
  drift: number
  driftPct: number
  paramChanges: { total: number; items: ParamChange[] }
  hasSnapshot: boolean
}

export async function reproduceOmArchive(id: number): Promise<ReproduceResult | null> {
  const row = (await db.prepare('SELECT * FROM om_projects WHERE id = ?').get(id)) as any
  if (!row) return null

  const stored = parseJson(row.result_json) as OmResult | null
  const snap = parseJson(row.params_snapshot) as OmParamSnapshot | null
  const items = (parseJson(row.items_snapshot) as OmItemInput[] | null) || []
  const engine: OmEngine = row.engine === 'quota' ? 'quota' : 'c1'
  const mgmt = row.mgmt_service_rate == null ? null : Number(row.mgmt_service_rate)
  const storedTotal = Number(row.total_amount ?? stored?.total ?? 0)

  const base: ReproduceResult = {
    id: Number(row.id),
    name: row.name,
    engine,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    operatorName: row.operator_name ?? null,
    itemCount: items.length,
    storedTotal,
    snapshotTotal: 0,
    snapshotLaborCost: 0,
    snapshotItemDrift: 0,
    reproducible: false,
    snapshotTakenAt: snap ? snap.takenAt : null,
    snapshotCounts: snap ? snap.counts : null,
    currentTotal: 0,
    currentLaborCost: 0,
    currentUnresolved: 0,
    drift: 0,
    driftPct: 0,
    paramChanges: { total: 0, items: [] },
    hasSnapshot: !!(snap && items.length),
  }
  if (!base.hasSnapshot) return base

  // ① 快照参数重算：这是「能不能复现」的本体
  const repro = calcOm(engine, items, snap!.params, { mgmtServiceRate: mgmt })
  base.snapshotTotal = repro.total
  base.snapshotLaborCost = repro.laborCost
  let driftRows = 0
  if (stored && Array.isArray(stored.items) && stored.items.length === repro.items.length) {
    for (let i = 0; i < repro.items.length; i++) {
      if (Math.abs((Number(repro.items[i].amount) || 0) - (Number(stored.items[i].amount) || 0)) > 0.01) driftRows++
    }
  } else {
    driftRows = -1 // 无法逐行比对（存档 result_json 缺 items 或行数不符）
  }
  base.snapshotItemDrift = driftRows
  base.reproducible = Math.abs(repro.total - storedTotal) < 0.01 && driftRows === 0

  // ② 当前参数重算：回答「今天再算一次会差多少」
  const curParams = await loadOmParams(row.wage_base_id ?? null)
  const cur = calcOm(engine, items, curParams, { mgmtServiceRate: mgmt })
  base.currentTotal = cur.total
  base.currentLaborCost = cur.laborCost
  base.currentUnresolved = cur.items.filter((x) => !x.resolved).length
  base.drift = cur.total - storedTotal
  base.driftPct = storedTotal ? (base.drift / storedTotal) * 100 : 0
  base.paramChanges = diffParams(snap!.params, curParams)

  return base
}
