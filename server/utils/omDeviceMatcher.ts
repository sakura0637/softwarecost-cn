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
