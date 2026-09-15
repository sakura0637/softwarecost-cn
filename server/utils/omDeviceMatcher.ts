// 设备价格库 → 运维测算 的取费匹配（纯函数、无副作用，便于 scripts/om_selftest.ts 断言）
//
// 两套引擎的匹配口径不同，这里分别实现：
//   quota 定额单价法：按**设备名**找定额条目（源表 B 法就是 MATCH(设备名, 定额表)）
//   c1    C.1工作量法：按**取费类别**算单位工作量，类别由 om_device_c1_map 规则给出
//                      （设备库没有这个维度 —— 实测自动映射率仅 0.2%，只能靠规则表）
//
// 性能：设备库单管理处最多约 1,800 行，逐行都要匹配。
// 因此规则排序做 WeakMap 缓存、定额库预建索引 —— 否则每行都要重排 138 条规则 / 重扫 349 条定额。

export interface DeviceMapRule {
  match_type: string          // name / keyword / subcategory / category
  match_value: string
  exclude_kw?: string | null
  c1_category?: string | null
  quota_ref?: string | null
  billable?: boolean | null
  priority?: number | null
}

export interface QuotaRow {
  name: string
  kind?: string | null
  point_based?: boolean | null
  formula?: string | null
}

export interface DeviceMatchResult {
  /** 命中的定额条目名（空 = 未命中） */
  quota_ref: string
  /** 命中方式：exact 精确 / norm 去符号 / substr 子串 / '' 未命中 */
  quota_how: string
  quota_kind: string
  quota_point_based: boolean
  /** 命中的 C.1 取费类别（空 = 未命中） */
  c1_category: string
  /** 命中的规则值（便于页面提示「按哪条规则给的类别」） */
  c1_rule: string
  billable: boolean
  /** 当前引擎下是否可算 */
  matched: boolean
}

/** 统一化设备名：去掉空白与常见括注/分隔符号，用于「写法不同但同一设备」的比对 */
export function normalizeDeviceName(s: unknown): string {
  return String(s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[（）()【】\[\]·、,，。.：:\-—_/]/g, '')
    .toLowerCase()
}

// 规则排序缓存：同一数组只排一次（接口每次请求复用同一个数组）
const sortedCache = new WeakMap<DeviceMapRule[], DeviceMapRule[]>()

/** 规则排序：priority 升序 → 匹配内容**长者优先**（更具体的先命中，避免「UPS」抢走「UPS配电柜」） */
export function sortRules(rules: DeviceMapRule[]): DeviceMapRule[] {
  const hit = sortedCache.get(rules)
  if (hit) return hit
  const out = [...rules].sort(
    (a, b) =>
      (a.priority ?? 100) - (b.priority ?? 100) ||
      String(b.match_value).length - String(a.match_value).length
  )
  sortedCache.set(rules, out)
  return out
}

/** C.1 取费类别匹配：name 全等 / 其余「包含」；设备名含任一排除词则本条规则让位 */
export function matchC1Rule(name: unknown, rules: DeviceMapRule[]): DeviceMapRule | null {
  const n = String(name ?? '').trim()
  if (!n) return null
  for (const r of sortRules(rules)) {
    if (r.billable === false && !r.c1_category) continue // 纯排除型规则不直接给出类别
    const ex = String(r.exclude_kw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ex.some((e) => n.includes(e))) continue
    if (r.match_type === 'name') {
      if (n === r.match_value) return r
    } else {
      if (r.match_value && n.includes(r.match_value)) return r
    }
  }
  return null
}

/** 定额库索引：把 349 条预编译成 Map，避免逐行线性扫描 + 重复规范化 */
export interface QuotaIndex {
  exact: Map<string, QuotaRow>
  normed: Map<string, QuotaRow[]>
  /** [规范化名, 行]，用于子串兜底匹配 */
  list: Array<{ key: string; row: QuotaRow }>
}

export function buildQuotaIndex(quotas: QuotaRow[]): QuotaIndex {
  const exact = new Map<string, QuotaRow>()
  const normed = new Map<string, QuotaRow[]>()
  const list: Array<{ key: string; row: QuotaRow }> = []
  for (const q of quotas) {
    const name = String(q.name ?? '')
    if (!name) continue
    if (!exact.has(name)) exact.set(name, q)
    const key = normalizeDeviceName(name)
    if (key) {
      const arr = normed.get(key)
      if (arr) arr.push(q)
      else normed.set(key, [q])
    }
    list.push({ key, row: q })
  }
  return { exact, normed, list }
}

/** 在索引上做定额匹配：精确同名 → 去符号同名 → 唯一子串（设备名更详细时） */
export function matchQuotaInIndex(
  name: unknown,
  idx: QuotaIndex
): { row: QuotaRow; how: string } | null {
  const n = String(name ?? '').trim()
  if (!n) return null

  const exact = idx.exact.get(n)
  if (exact) return { row: exact, how: 'exact' }

  const nn = normalizeDeviceName(n)
  if (!nn) return null

  const normed = idx.normed.get(nn)
  if (normed && normed.length === 1) return { row: normed[0], how: 'norm' }

  // 子串：要求定额条目名足够长（规范化后 ≥4 字）且唯一命中，避免短名乱配
  let found: QuotaRow | null = null
  let count = 0
  for (const { key, row } of idx.list) {
    if (key.length < 4) continue
    if (nn.includes(key) || key.includes(nn)) {
      found = row
      if (++count > 1) break
    }
  }
  if (count === 1 && found) return { row: found, how: 'substr' }
  return null
}

/** 便利封装：零散调用时可直接传数组（内部建索引；批量场景请自行复用 QuotaIndex） */
export function matchQuotaItem(
  name: unknown,
  quotas: QuotaRow[]
): { row: QuotaRow; how: string } | null {
  return matchQuotaInIndex(name, buildQuotaIndex(quotas))
}

/** 对单个设备名做两法匹配，返回统一结果 */
export function matchDevice(
  name: unknown,
  quotas: QuotaIndex | QuotaRow[],
  rules: DeviceMapRule[],
  engine: 'c1' | 'quota'
): DeviceMatchResult {
  const idx = Array.isArray(quotas) ? buildQuotaIndex(quotas) : quotas
  const q = matchQuotaInIndex(name, idx)
  const rule = matchC1Rule(name, rules)
  const res: DeviceMatchResult = {
    quota_ref: q ? q.row.name : '',
    quota_how: q ? q.how : '',
    quota_kind: q?.row.kind || '',
    quota_point_based: q?.row.point_based === true,
    c1_category: rule?.c1_category || '',
    c1_rule: rule?.match_value || '',
    billable: rule ? rule.billable !== false : true,
    matched: false,
  }
  res.matched = engine === 'quota' ? !!res.quota_ref : !!res.c1_category
  return res
}

// ── 站点筛选：管理处 → 子站 两级多选 ──────────────────────────────
// 页面要按站点挑设备（照搬设备价格库导出弹窗的两级勾选）。
// 选择项编码成 `管理处::子站`，子站为 * 表示「该管理处全部子站」。

/** 「该管理处全部子站」的通配值 */
export const SITE_ANY = '*'

export interface SiteSubNode {
  name: string
  count: number
}
export interface SiteNode {
  station: string
  /** 该管理处下各子站设备行数合计（不含被排除的汇总站） */
  count: number
  subsites: SiteSubNode[]
}
export interface SiteSel {
  station: string
  subsite: string
}

/**
 * 从设备行汇总出「管理处 → 子站」树。
 * `is_summary` 为真的站点要在**取数之前**就排除掉 —— 它是各管理处的
 * 「全站设备汇总」行，与明细重复，选中会让金额翻倍。
 * （总调中心没有真实子站，它的汇总站 `is_summary` 为 false，属正常站点，保留。）
 */
export function buildSiteTree(
  rows: Array<{ station?: unknown; subsite?: unknown; is_summary?: unknown }>
): SiteNode[] {
  const byStation = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (r.is_summary === true) continue
    const station = String(r.station ?? '').trim()
    if (!station) continue
    const sub = String(r.subsite ?? '').trim() || '（直属）'
    let m = byStation.get(station)
    if (!m) {
      m = new Map()
      byStation.set(station, m)
    }
    m.set(sub, (m.get(sub) || 0) + 1)
  }
  const zh = (a: string, b: string) => a.localeCompare(b, 'zh-Hans-CN')
  return [...byStation.entries()]
    .map(([station, m]) => {
      const subsites = [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => zh(a.name, b.name))
      return { station, subsites, count: subsites.reduce((a, s) => a + s.count, 0) }
    })
    .sort((a, b) => zh(a.station, b.station))
}

/** 解析 `sites` 查询参数（`管理处::子站`，可重复或逗号分隔；子站省略即该管理处全部） */
export function parseSiteSelection(raw: unknown): SiteSel[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(',')
  const out: SiteSel[] = []
  for (const p of parts) {
    let v = String(p || '').trim()
    if (!v) continue
    try {
      v = decodeURIComponent(v)
    } catch {
      /* 非法转义则按原样处理 */
    }
    const i = v.indexOf('::')
    const station = (i >= 0 ? v.slice(0, i) : v).trim()
    const subsite = ((i >= 0 ? v.slice(i + 2) : '') || '').trim() || SITE_ANY
    if (!station) continue
    out.push({ station, subsite })
  }
  return out
}

/** 站点选择 → WHERE 片段（`?` 占位符，交由 db 包装层转 $n）；空选择返回 TRUE（即不限） */
export function buildSiteWhere(sites: SiteSel[]): { sql: string; params: string[] } {
  if (!sites.length) return { sql: 'TRUE', params: [] }
  const ors: string[] = []
  const params: string[] = []
  for (const s of sites) {
    if (s.subsite === SITE_ANY) {
      ors.push('station = ?')
      params.push(s.station)
    } else {
      ors.push('(station = ? AND subsite = ?)')
      params.push(s.station, s.subsite)
    }
  }
  return { sql: `(${ors.join(' OR ')})`, params }
}

/** 站点选择 → 人类可读摘要（用于页面与接口回显） */
export function describeSiteSelection(sites: SiteSel[], tree: SiteNode[]): string {
  if (!sites.length) return '全部站点'
  const parts: string[] = []
  for (const s of sites) {
    if (s.subsite === SITE_ANY) parts.push(`${s.station}（全部子站）`)
    else parts.push(`${s.station} · ${s.subsite}`)
  }
  const rows = countSelectedRows(sites, tree)
  return `${parts.join('、')}（共 ${rows.toLocaleString('zh-CN')} 台/套）`
}

/** 站点选择命中的设备行数（用于页面显示「已选 N 行」） */
export function countSelectedRows(sites: SiteSel[], tree: SiteNode[]): number {
  if (!sites.length) return tree.reduce((a, n) => a + n.count, 0)
  let n = 0
  for (const sel of sites) {
    const node = tree.find((t) => t.station === sel.station)
    if (!node) continue
    if (sel.subsite === SITE_ANY) n += node.count
    else n += node.subsites.find((s) => s.name === sel.subsite)?.count || 0
  }
  return n
}
