import db from './db'

// 统一「计价标准档位」构建器：把 estimation_parameters 里各标准抽成可直接用于测算的档位。
// 被 /api/pricing-standards 与 /api/projects/[id]/calculate 共用，避免两处各写一份。
//
// 核心口径（务必与 estimationData.ts 保持一致）：
//   生产率(FP/人月)   = hm ÷ pdr
//   功能点单价(元/FP) = rate ÷ 生产率 = rate × pdr ÷ hm
// ⚠️ 不是 rate ÷ pdr —— 那个量纲是 元·FP/(人月·人时)，无物理意义，会把单价算高约 3.4 倍。
//
// 有的标准自带人月费率（四川/北京/CSBMK-201809）→ rateMode='standard'
// 有的只有生产率（CSBMK-2025/CSBSG-2021 等行业基准）→ rateMode='city'，由前端选城市补费率
// 缺失项按固定规则补齐，并在 filled 字段标注来源：可追溯，不静默猜测。

export interface PdrOption {
  label: string
  value: number
}
export interface PricingStandard {
  id: string
  name: string
  code: string
  region: string
  org: string
  category: string
  edition: string
  hm: number
  rate: number | null
  pdr: number | null
  pdrOptions: PdrOption[]
  usable: boolean // 能否用于测算（false = 缺少生产率或费率，选城市也补不上）
  productivity: number | null
  fpPrice: number | null
  laborRateWan: number | null
  cf: number | null
  factors: Record<string, { label: string; factor: number | string }[]>
  rateMode: 'standard' | 'city'
  suggestedCity: string
  complete: boolean
  missing: string[]
  filled: string[]
  paramCount: number
  source: string
}

function num(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 省会/代表城市：标准未给费率时，用该地城市费率补齐
const PROVINCE_CITY: Record<string, string> = {
  四川: '成都',
  北京: '北京',
  山东: '济南',
  江西: '南昌',
  河南: '郑州',
  山西: '太原',
  河北: '石家庄',
  全国: '',
}

const FALLBACK_HM = 174 // 8h/天 × 21.75 天/月
// 生产率兜底值按「开发 / 运维」分开，且仅在该标准确有生产率参数、只是没给数值时使用
const FALLBACK_PDR_DEV = 6.72 // CSBMK 2025 全行业 P50（开发）
const FALLBACK_PDR_MAINT = 1.07 // DB11/T 1424-2017 北京运维 P50（运维）
// ⚠️ 两者不可混用：运维生产率比开发小一个数量级（0.74~1.07 vs 6.72~7.16 人时/FP）。
//    把开发生产率套到运维标准上会算出荒谬的运维单价，务必按 category 区分。

function pickDefaultPdr(options: PdrOption[]): number | null {
  if (!options.length) return null
  // 优先「全行业 P50」，其次任意 P50，最后取第一项
  return (
    options.find((o) => o.label.includes('全行业') && o.label.includes('P50'))?.value ??
    options.find((o) => o.label.includes('P50'))?.value ??
    options[0].value
  )
}

export async function buildPricingStandards() {
  const paramRows = (await db.prepare('SELECT * FROM estimation_parameters ORDER BY standard_id, seq').all()) as any[]

  // 各城市开发/运维费率（用于 rateMode='city' 及缺费率时补齐）
  const rateRows = (await db
    .prepare('SELECT city, year, rate_type, rate, source FROM city_rates')
    .all()) as any[]

  const cityRate = (city: string, type: 'development' | 'maintenance') => {
    const hits = rateRows.filter((r) => r.city === city && r.rate_type === type)
    if (!hits.length) return null
    const y = Math.max(...hits.map((h) => Number(h.year)))
    const row = hits.find((h) => Number(h.year) === y)
    return row ? { rate: Number(row.rate), year: Number(row.year), source: row.source } : null
  }

  // 城市清单（前端下拉用）
  const citySet = new Map<string, { city: string; development: number | null; maintenance: number | null }>()
  for (const r of rateRows) {
    const cur = citySet.get(r.city) || { city: r.city, development: null, maintenance: null }
    const v = Number(r.rate)
    const y = Number(r.year)
    if (r.rate_type === 'development') {
      if (cur.development == null || y >= 2025) cur.development = v
    } else if (cur.maintenance == null || y >= 2025) {
      cur.maintenance = v
    }
    citySet.set(r.city, cur)
  }

  const byStd = new Map<string, any[]>()
  for (const p of paramRows) {
    if (!byStd.has(p.standard_id)) byStd.set(p.standard_id, [])
    byStd.get(p.standard_id)!.push(p)
  }

  const standards: PricingStandard[] = []

  for (const [sid, items] of byStd) {
    const head = items[0]
    const category = head.category || '开发'
    const find = (pred: (p: any) => boolean) => items.find(pred)

    const parseValues = (p: any): any[] => {
      if (!p) return []
      let v = p.values
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v)
        } catch {
          v = []
        }
      }
      return Array.isArray(v) ? v : []
    }

    // ---- hm ----
    let hm = num(parseValues(find((p) => p.param_name === '人月折算系数'))[0]?.factor)
    const filled: string[] = []
    if (hm == null) {
      hm = FALLBACK_HM
      filled.push(`hm 取通用值 ${FALLBACK_HM}（8h/天 × 21.75天/月）`)
    }

    // ---- rate ----
    // suggestedCity：该地区对应的代表城市。标准未给费率时用它补齐；
    // 即使标准自带费率，也一并返回，便于用户按城市重新取费（如四川标准改按成都价）。
    const suggestedCity = PROVINCE_CITY[head.region] || ''
    let rate = num(
      parseValues(find((p) => p.param_name === '平均人力成本费率' || p.param_name === '基准人月费率'))[0]?.factor
    )
    const rateMode: 'standard' | 'city' = rate == null ? 'city' : 'standard'
    if (rate == null) {
      const cname = suggestedCity
      const cr = cname ? cityRate(cname, category === '运维' ? 'maintenance' : 'development') : null
      if (cr) {
        rate = cr.rate
        filled.push(`rate 取${cname}${cr.year}年城市费率 ${cr.rate} 元/人月`)
      }
    }

    // ---- pdr 选项（严格区分开发/运维，避免把开发生产率套到运维标准上） ----
    const pdrOptions: PdrOption[] = []
    let hasProductivityParam = false
    for (const p of items) {
      if (p.param_type !== 'productivity') continue
      hasProductivityParam = true
      const isMaint = /运维/.test(p.param_name)
      if ((category === '运维') !== isMaint) continue
      for (const v of parseValues(p)) {
        const n = num(v.factor)
        if (n != null) pdrOptions.push({ label: v.label, value: n })
      }
    }
    let pdr: number | null = pickDefaultPdr(pdrOptions)
    if (pdr == null && hasProductivityParam) {
      // 标准有生产率参数、只是没给具体数值（如山东「按业务领域 P50 参考CSBMK」），
      // 属于"明确指向外部基准"，按类别取对应兜底值是合理的。
      pdr = category === '运维' ? FALLBACK_PDR_MAINT : FALLBACK_PDR_DEV
      filled.push(
        category === '运维'
          ? `pdr 取北京运维标准 P50 = ${FALLBACK_PDR_MAINT} 人时/FP`
          : `pdr 取 CSBMK 2025 全行业 P50 = ${FALLBACK_PDR_DEV} 人时/FP`
      )
    }
    // 完全没有生产率参数的标准（GB/T 36964、GB/T 28827.7、DB14/T 2163 等方法/因子标准）
    // 保持 pdr=null 并计入 missing —— 不做兜底，否则会伪装成可测算、算出无意义的结果。

    // ---- 调整因子 ----
    const factorOf = (keywords: string[]) => {
      const p = find((x) => keywords.some((k) => x.param_name.includes(k)))
      return parseValues(p)
        .map((v: any) => ({ label: v.label, factor: v.factor }))
        .filter((v: any) => v.label)
    }
    const factors = {
      applicationType: factorOf(['应用类型']),
      platform: factorOf(['开发平台', '开发语言']),
      team: factorOf(['开发团队背景']),
      nonFunctional: factorOf(['非功能性']),
      scaleChange: factorOf(['规模变更', '规模调整']),
      reuse: factorOf(['复用']),
    }

    const missing: string[] = []
    if (rate == null) missing.push('人月费率')
    if (pdr == null) missing.push('基准生产率')

    // usable：能否用于测算。有生产率，且（有费率 或 选城市后可取到费率）
    // complete：参数全由标准给定、无需补齐、也无需补选城市
    const usable = pdr != null && (rate != null || rateMode === 'city')
    const complete = usable && filled.length === 0 && rate != null

    let productivity: number | null = null
    let fpPrice: number | null = null
    if (rate != null && pdr != null) {
      productivity = Math.round((hm / pdr) * 100) / 100
      fpPrice = Math.round((rate * pdr) / hm)
    }

    standards.push({
      id: sid,
      name: head.standard_name,
      code: head.standard_code,
      region: head.region,
      org: head.org,
      category,
      edition: head.edition,
      hm,
      rate,
      pdr,
      pdrOptions,
      productivity,
      fpPrice,
      laborRateWan: rate != null ? Math.round((rate / 10000) * 100) / 100 : null,
      cf: num(parseValues(find((p) => p.param_name.includes('规模变更') || p.param_name.includes('规模调整')))[0]?.factor),
      factors,
      rateMode,
      suggestedCity,
      usable,
      complete,
      missing,
      filled,
      paramCount: items.length,
      source: head.standard_code || head.standard_name,
    })
  }

  // 排序：完整档位在前 → 开发优先于运维 → 按 id
  standards.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1
    if (a.category !== b.category) return a.category === '开发' ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  return { standards, cities: [...citySet.values()].sort((a, b) => (b.development || 0) - (a.development || 0)) }
}
