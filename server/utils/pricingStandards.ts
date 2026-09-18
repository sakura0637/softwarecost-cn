import db from './db'
import { loadBindings, profileFrom, type UfpProfile } from './pricingParams'

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
  /** 该标准在「造价标准」主表里的 id（standards.id）；解析不到为 null。
   *  用途：新建项目页选的是 standards.id，而本清单的 id 是 estimation_parameters.standard_id，
   *  两者不是一套命名 —— 靠本字段桥接，否则项目选定的标准在测算时匹配不上。 */
  stdId: string | null
  /** 本标准采用的功能点方法与复杂度判定矩阵（standard_benchmarks 声明 → 回落全局默认）。
   *  weights / rules 只在「该标准自己声明了、与全局默认不同」时才随行下发，避免重复 25 份矩阵。 */
  ufp: UfpBrief
}

export interface UfpBrief {
  method: string
  methodLabel: string
  complexityBased: boolean
  methodSource: string
  rulesSource: string
  standardId: string | null
  weights?: UfpProfile['weights']
  rules?: UfpProfile['rules']
}

/** 全局默认的功能点方法与其权值/矩阵（客户端按标准取用；标准自己声明了就用标准那份） */
export interface UfpDefaults {
  method: string
  methodLabel: string
  complexityBased: boolean
  weights: UfpProfile['weights']
  rules: UfpProfile['rules']
}

function num(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ⚠️ 本文件不再硬编码任何兜底值/映射 —— 全部读 pricing_defaults（唯一取数出口见 pricingParams.ts）。
//    历史：省会代表城市、兜底 HM、开发/运维兜底生产率曾写死在这里，改一次要发一次版；
//    现在改「数据维护 → 全局兜底 → 全局测算兜底」即时生效。
//    这两个兜底生产率仍不可混用：运维生产率比开发小一个数量级（0.74~1.07 vs 6.72~7.16 人时/FP），
//    把开发生产率套到运维标准上会算出荒谬的运维单价，故按 category 分开取。

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
  // 全局兜底参数 + 标准声明（功能点方法 / 复杂度矩阵）：一次读全，循环里不再查库
  const ctx = await loadBindings()
  const d = ctx.defaults

  // ⚠️ 必须过滤 is_active：本表是计价引擎唯一真正读取的参数表，
  // 而它同时也是数据维护后台里可被「停用」的表 —— 不过滤的话，后台那个开关就是个摆设，
  // 用户停用一条参数（如某个不适用的省标费率）却发现测算页照旧能选到它。
  // 用 IS NOT FALSE 而非 = true：兼容历史 NULL 行（老库该列曾可为空）。
  const paramRows = (await db
    .prepare('SELECT * FROM estimation_parameters WHERE is_active IS NOT FALSE ORDER BY standard_id, seq')
    .all()) as any[]

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
    // ⚠️ 一律按 param_key 取数，不按中文名 —— 理由见 server/config/paramKeys.ts 顶部注释：
    //    按名字匹配时，后台改个中文名就静默掉兜底值，而兜底 HM(174) 恰好等于多数标准的取值，
    //    失配被数值巧合掩盖（只有北京的 176 会悄悄变 174）。改名不再影响测算。
    let hm = num(parseValues(find((p) => p.param_key === 'hm'))[0]?.factor)
    const filled: string[] = []
    if (hm == null) {
      hm = d.fallbackHm.value
      filled.push(`hm 取全局兜底值 ${d.fallbackHm.value}（${d.fallbackHm.note}）`)
    }

    // ---- rate ----
    // suggestedCity：该地区对应的代表城市（来自「全局测算兜底」表的省份映射）。标准未给费率时用它补齐；
    // 即使标准自带费率，也一并返回，便于用户按城市重新取费（如四川标准改按成都价）。
    const suggestedCity = d.provinceCity[head.region] || ''
    let rate = num(parseValues(find((p) => p.param_key === 'rate'))[0]?.factor)
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
    // 分档靠参数键本身（pdr_dev / pdr_ops），不再靠名字里有没有「运维」二字。
    // 等价性：csbmk-2025 组里有 1 行运维生产率、组头类别却是「开发」，
    //        改造前靠名字判定把它跳过；现在它带的是 pdr_ops 键，同样进不了 pdr_dev 的选取范围。
    const pdrKey = category === '运维' ? 'pdr_ops' : 'pdr_dev'
    const pdrOptions: PdrOption[] = []
    // 「给出过生产率」的判据是参数类型，不是能否取到数字 ——
    // 山东那种「按业务领域 P50 参考CSBMK」（值指向外部基准）也算给出过，应走兜底而非算作缺失。
    const hasProductivityParam = items.some((p) => p.param_type === 'productivity')
    for (const p of items) {
      if (p.param_key !== pdrKey) continue
      for (const v of parseValues(p)) {
        const n = num(v.factor)
        if (n != null) pdrOptions.push({ label: v.label, value: n })
      }
    }
    let pdr: number | null = pickDefaultPdr(pdrOptions)
    if (pdr == null && hasProductivityParam) {
      // 标准有生产率参数、只是没给具体数值（如山东「按业务领域 P50 参考CSBMK」），
      // 属于"明确指向外部基准"，按类别取对应兜底值是合理的（兜底值来自「全局测算兜底」表）。
      const fb = category === '运维' ? d.fallbackPdr.maintenance : d.fallbackPdr.development
      pdr = fb.value
      filled.push(`pdr 取${fb.note || '全局兜底值'} = ${fb.value} 人时/FP`)
    }
    // 完全没有生产率参数的标准（GB/T 36964、GB/T 28827.7、DB14/T 2163 等方法/因子标准）
    // 保持 pdr=null 并计入 missing —— 不做兜底，否则会伪装成可测算、算出无意义的结果。

    // ---- 调整因子 ----
    const factorOf = (key: string) => {
      const p = find((x) => x.param_key === key)
      return parseValues(p)
        .map((v: any) => ({ label: v.label, factor: v.factor }))
        .filter((v: any) => v.label)
    }
    const factors = {
      applicationType: factorOf('app_type_factor'),
      platform: factorOf('platform_factor'),
      team: factorOf('team_factor'),
      nonFunctional: factorOf('nonfunc_factor'),
      scaleChange: factorOf('scale_change_factor'),
      reuse: factorOf('reuse_factor'),
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

    // ---- 功能点方法与复杂度判定矩阵（标准声明 → 回落全局默认）----
    const prof = profileFrom(ctx, sid)
    const ufp: UfpBrief = {
      method: prof.method,
      methodLabel: prof.methodLabel,
      complexityBased: prof.complexityBased,
      methodSource: prof.methodSource,
      rulesSource: prof.rulesSource,
      standardId: prof.standardId,
    }
    // 只有「该标准自己声明了、与全局默认不同」时才随行下发实体，避免每行重复 25 份矩阵
    if (prof.methodSource === '标准声明') ufp.weights = prof.weights
    if (prof.rulesSource === '标准声明') ufp.rules = prof.rules
    if (prof.methodSource === '全局默认' && prof.rulesSource === '全局默认' && !prof.standardId) {
      // 既没声明、又没关联到标准主库：不是错误，但要在 filled 里说清用的是哪套默认
      filled.push(`功能点方法取全局默认「${prof.methodLabel}」`)
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
      cf: num(parseValues(find((p) => p.param_key === 'scale_change_factor'))[0]?.factor),
      factors,
      rateMode,
      suggestedCity,
      usable,
      complete,
      missing,
      filled,
      paramCount: items.length,
      source: head.standard_code || head.standard_name,
      stdId: prof.standardId,
      ufp,
    })
  }

  // 排序：完整档位在前 → 开发优先于运维 → 按 id
  standards.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1
    if (a.category !== b.category) return a.category === '开发' ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  const defMethod = d.ufpLibrary.methods[d.ufpLibrary.default]
  return {
    standards,
    cities: [...citySet.values()].sort((a, b) => (b.development || 0) - (a.development || 0)),
    // 全局默认的功能点方法与其权值 / 判定矩阵：客户端按选中的标准取用
    ufpDefaults: {
      method: d.ufpLibrary.default,
      methodLabel: defMethod.label,
      complexityBased: defMethod.complexityBased,
      weights: defMethod.weights,
      rules: d.complexityRules,
    } as UfpDefaults,
  }
}
