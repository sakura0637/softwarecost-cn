import db from '../../utils/db'
import {
  matchDevice,
  buildQuotaIndex,
  buildSiteTree,
  parseSiteSelection,
  buildSiteWhere,
  countSelectedRows,
  describeSiteSelection,
  type DeviceMapRule,
  type QuotaRow,
} from '../../utils/omDeviceMatcher'

// 设备价格库 → 运维测算取数（POST：站点选择是一组集合，用请求体传更稳，不受 URL 长度限制）
//
// 为什么要有它：测算页原来的「示例清单」来自源表《C1取费对照表》的 171 行，
// 只够验证引擎口径；实际测算要用的是**本系统设备价格库**里的真实设备台账。
// 本接口把设备库（devices / stations / station_devices → v_device_prices 视图）
// 按站点拉出来，逐行做两法取费匹配：
//   quota 定额单价法：设备名 → 定额条目（精确 → 去符号 → 唯一子串）
//   c1    C.1工作量法：设备名 → om_device_c1_map 规则 → C.1 取费类别
// 匹配结果只作为**初值**返回，页面可逐行改；未命中的行不会被丢掉，会原样返回并计数。
//
// 入参（JSON body）：
//   all: true           全部站点（等价于「全选」）
//   sites: string[]     选中项 `管理处::子站`；与 all 同时给出时以 all 为准
//   engine: c1|quota    仅影响 matched 标记（两法匹配结果都会返回，页面切引擎无需重新请求）
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const engine: 'c1' | 'quota' = body?.engine === 'quota' ? 'quota' : 'c1'
  const isAll = body?.all === true
  const sites = isAll ? [] : parseSiteSelection(body?.sites)

  // 站点树 → 用于回显「已选 N 个子站 / 共 M 行」
  const treeRows = (await db
    .prepare(
      `SELECT station, subsite, is_summary
         FROM v_device_prices
        WHERE is_summary IS NOT TRUE AND station IS NOT NULL AND station <> ''`
    )
    .all()) as Array<{ station: string; subsite: string; is_summary: boolean }>
  const stationTree = buildSiteTree(treeRows)

  // 明确「一个站点都没选」→ 直接返回空，不要退化成「全部」
  if (!isAll && sites.length === 0) {
    return {
      engine,
      stationTree,
      sites: [],
      siteLabel: '未选择任何站点',
      stats: { total: 0, matched: 0, unmatched: 0, quotaHit: 0, c1Hit: 0, allRows: 0, selectedRows: 0 },
      items: [],
    }
  }

  // 参数表体量很小（定额 349 / 规则 138），一次载入内存做匹配，避免逐行查库
  const quotas = (await db
    .prepare('SELECT name, kind, point_based, formula FROM om_quota_items WHERE is_active IS NOT FALSE')
    .all()) as QuotaRow[]
  const quotaIndex = buildQuotaIndex(quotas)
  const rules = (await db
    .prepare(
      `SELECT match_type, match_value, exclude_kw, c1_category, quota_ref, billable, priority
         FROM om_device_c1_map WHERE is_active IS NOT FALSE`
    )
    .all()) as DeviceMapRule[]

  const { sql: siteSql, params: siteParams } = buildSiteWhere(sites)
  const rows = (await db
    .prepare(
      `SELECT station, subsite, category, subcategory, name, brand_model, unit, qty, unit_price
         FROM v_device_prices
        WHERE is_summary IS NOT TRUE AND ${siteSql}
        ORDER BY station, subsite, category, subcategory, name`
    )
    .all(...siteParams)) as Array<Record<string, unknown>>

  const items = rows.map((r, i) => {
    const m = matchDevice(r.name, quotaIndex, rules, engine)
    return {
      seq: i + 1,
      station: r.station || '',
      subsite: r.subsite || '',
      category: r.category || '',
      subcategory: r.subcategory || '',
      name: r.name || '',
      brand_model: r.brand_model || '',
      unit: r.unit || '',
      qty: Number(r.qty) || 0,
      unit_price: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
      // ── 匹配结果（两法都给出，便于页面切引擎时无需重新请求）──
      quota_ref: m.quota_ref,
      quota_how: m.quota_how,
      quota_kind: m.quota_kind,
      quota_point_based: m.quota_point_based,
      c1_category: m.c1_category,
      c1_rule: m.c1_rule,
      billable: m.billable,
      matched: m.matched,
    }
  })

  const allRows = stationTree.reduce((a, n) => a + n.count, 0)
  const stats = {
    total: items.length,
    matched: items.filter((x) => x.matched).length,
    unmatched: items.filter((x) => !x.matched).length,
    quotaHit: items.filter((x) => x.quota_ref).length,
    c1Hit: items.filter((x) => x.c1_category).length,
    allRows,
    selectedRows: isAll ? allRows : countSelectedRows(sites, stationTree),
  }

  return {
    engine,
    stationTree,
    sites,
    siteLabel: isAll ? `全部站点（${allRows.toLocaleString('zh-CN')} 行）` : describeSiteSelection(sites, stationTree),
    stats,
    items,
  }
})
