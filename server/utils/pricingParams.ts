// 测算参数的唯一取数出口。
//
// 【为什么要有这个文件】以前 UFP 权值硬编码在 pages/projects/[id].vue 与 server/utils/pricing.ts
//   两处，兜底 HM / 生产率 / 省份→城市映射又硬编码在 pricingStandards.ts。
//   「同一份参数散落多处」必然导致改一处不生效、以及多处慢慢漂移。
//   现在所有领域参数一律经这里从库里取，代码里不再有字面量。
//
// 【取数优先级】
//   功能点方法 / 复杂度判定矩阵：标准声明（standard_benchmarks.algorithm / complexity_rules）
//                                 → 全局默认（pricing_defaults.ufp_methods / complexity_rules）
//   兜底值 / 省份映射：全局默认（pricing_defaults）
//
// 【失败姿势】缺表、缺 key、JSON 坏、矩阵结构不合法 —— 一律当场抛错。
//   宁可测算失败，也不给错数（静默兜底是本项目反复踩过的坑）。

import db from './db'
import {
  type ComplexityRules,
  type UfpMethod,
  validateComplexityRules,
  validateUfpMethods,
} from '../../shared/ufp'

export interface UfpLibrary {
  default: string
  methods: Record<string, UfpMethod>
}

export interface FallbackEntry {
  value: number
  note: string
}

export interface PricingDefaults {
  ufpLibrary: UfpLibrary
  complexityRules: ComplexityRules
  fallbackHm: FallbackEntry
  fallbackPdr: { development: FallbackEntry; maintenance: FallbackEntry }
  provinceCity: Record<string, string>
}

/** 某次测算实际采用的功能点方法 + 判定矩阵（含来源说明，便于界面/报告回溯） */
export interface UfpProfile {
  /** 采用的方法代号，如 ifpug-ufp */
  method: string
  methodLabel: string
  complexityBased: boolean
  weights: UfpMethod['weights']
  rules: ComplexityRules
  /** 方法来源：'标准声明' | '全局默认' */
  methodSource: string
  /** 矩阵来源：'标准声明' | '全局默认' */
  rulesSource: string
  /** 解析出的标准主表 id（standards.id）；解析不到为 null（不代表出错，回落全局默认） */
  standardId: string | null
}

/** 绑定上下文：一次读全，避免在循环里反复查库 */
export interface BindingContext {
  defaults: PricingDefaults
  standardIds: Set<string>
  stdByName: Map<string, string>
  stdByCodeNorm: Map<string, string>
  bmByStandardId: Map<string, { algorithm: string | null; complexityRules: any }>
  epBySid: Map<string, { standard_code: string | null; standard_name: string | null }>
}

/** 标准编号归一化：破折号/连字符统一、全角括号转半角、去空格、转小写（与迁移脚本同一套规则） */
export function normCode(c: any): string {
  if (!c) return ''
  return String(c)
    .replace(/[—–−]/g, '-')
    .replace(/[〔【]/g, '(')
    .replace(/[〕】]/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim()
}

function fail(msg: string): never {
  throw new Error(`[测算参数] ${msg}`)
}

const DEFAULT_KEYS: Record<string, string> = {
  ufp_methods: '功能点方法库',
  complexity_rules: '复杂度判定矩阵',
  fallback_hm: '人月折算系数兜底值',
  fallback_pdr: '基准生产率兜底值',
  province_city: '省份 → 代表城市',
}

/**
 * 读取全部全局兜底参数。缺 key / JSON 坏 / 结构不合法一律抛错。
 * 注意：本函数不做缓存 —— 参数可能刚被后台改过，宁可多查一次也要读准。
 */
export async function loadPricingDefaults(): Promise<PricingDefaults> {
  // 列名 key / value 虽是 PG 非保留字，仍统一加引号 —— 免得上游哪天改了保留字规则直接炸
  const rows = (await db.prepare('SELECT "key", "value" FROM pricing_defaults').all()) as any[]
  const map = new Map(rows.map((r) => [String(r.key), r.value]))

  const parse = (key: string): any => {
    if (!map.has(key)) {
      fail(
        `全局兜底表 pricing_defaults 缺少「${key}」（${DEFAULT_KEYS[key] || ''}），拒绝测算。` +
          `请到「数据维护 → 全局兜底 → 全局测算兜底」补上该行。`
      )
    }
    const raw = map.get(key)
    if (typeof raw !== 'string' || !raw.trim()) fail(`pricing_defaults.${key} 的值为空`)
    try {
      return JSON.parse(raw)
    } catch (e: any) {
      fail(`pricing_defaults.${key} 不是合法 JSON：${e.message}`)
    }
  }

  // —— 功能点方法库 ——
  const lib = parse('ufp_methods')
  if (!lib?.methods || typeof lib.methods !== 'object') fail('ufp_methods 缺少 methods 段')
  const methodProblems = validateUfpMethods(lib.methods)
  if (methodProblems.length) fail(`功能点方法库不合法：${methodProblems.join('；')}`)
  if (!lib.default || !lib.methods[lib.default]) {
    fail(`ufp_methods.default 指向的方法「${lib.default}」不存在`)
  }

  // —— 复杂度判定矩阵 ——
  const rules = parse('complexity_rules')
  const ruleProblems = validateComplexityRules(rules)
  if (ruleProblems.length) fail(`复杂度判定矩阵不合法：${ruleProblems.join('；')}`)

  // —— 兜底值 ——
  const hm = parse('fallback_hm')
  if (!Number.isFinite(Number(hm?.value))) fail('fallback_hm.value 不是数字')
  const pdr = parse('fallback_pdr')
  if (!Number.isFinite(Number(pdr?.development?.value)) || !Number.isFinite(Number(pdr?.maintenance?.value))) {
    fail('fallback_pdr 必须同时给出 development.value 与 maintenance.value（开发/运维不可混用）')
  }

  const cityMap = parse('province_city')
  if (!cityMap || typeof cityMap !== 'object' || Array.isArray(cityMap)) fail('province_city 必须是对象')

  return {
    ufpLibrary: { default: String(lib.default), methods: lib.methods as Record<string, UfpMethod> },
    complexityRules: rules as ComplexityRules,
    fallbackHm: { value: Number(hm.value), note: String(hm.note || '') },
    fallbackPdr: {
      development: { value: Number(pdr.development.value), note: String(pdr.development.note || '') },
      maintenance: { value: Number(pdr.maintenance.value), note: String(pdr.maintenance.note || '') },
    },
    provinceCity: cityMap as Record<string, string>,
  }
}

/**
 * 一次读全解析所需的全部上下文（全局兜底 + 标准目录 + 标准声明 + 参数表的两套 id）。
 * 用于「一次处理多个标准」的场景（如 /api/pricing-standards），避免 N 次查库。
 */
export async function loadBindings(): Promise<BindingContext> {
  const defaults = await loadPricingDefaults()
  const stds = (await db.prepare('SELECT id, code, name FROM standards').all()) as any[]
  const bms = (await db.prepare('SELECT standard_id, algorithm, complexity_rules FROM standard_benchmarks').all()) as any[]
  const eps = (await db.prepare(
    'SELECT DISTINCT standard_id, standard_code, standard_name FROM estimation_parameters'
  ).all()) as any[]

  const standardIds = new Set(stds.map((s) => String(s.id)))
  const stdByName = new Map<string, string>()
  const stdByCodeNorm = new Map<string, string>()
  for (const s of stds) {
    if (s.name) stdByName.set(String(s.name), String(s.id))
    if (s.code) stdByCodeNorm.set(normCode(s.code), String(s.id))
  }

  const bmByStandardId = new Map<string, { algorithm: string | null; complexityRules: any }>()
  for (const b of bms) {
    // 同行可能有多条（迁移按参数行拆过）。以「有声明的那条」为准，避免被空行盖掉。
    const prev = bmByStandardId.get(String(b.standard_id))
    const next = {
      algorithm: b.algorithm ? String(b.algorithm) : null,
      complexityRules: b.complexity_rules || null,
    }
    if (!prev || (!prev.algorithm && next.algorithm) || (!prev.complexityRules && next.complexityRules)) {
      bmByStandardId.set(String(b.standard_id), next)
    }
  }

  const epBySid = new Map<string, { standard_code: string | null; standard_name: string | null }>()
  for (const e of eps) {
    epBySid.set(String(e.standard_id), { standard_code: e.standard_code, standard_name: e.standard_name })
  }

  return { defaults, standardIds, stdByName, stdByCodeNorm, bmByStandardId, epBySid }
}

/**
 * 把「一个标准」解析成 standards.id。
 * 入参可能是 standards.id（如 sc-t-0015），也可能是 estimation_parameters.standard_id（如 scsia-0015-2025）
 * —— 系统里这两套 id 命名并存，统一前靠「标准编号归一化 → 名称」匹配桥接。
 */
export function resolveStandardId(ctx: BindingContext, key?: string | null): string | null {
  if (!key) return null
  if (ctx.standardIds.has(key)) return key
  const ep = ctx.epBySid.get(key)
  if (ep) {
    if (ep.standard_code) {
      const hit = ctx.stdByCodeNorm.get(normCode(ep.standard_code))
      if (hit) return hit
    }
    if (ep.standard_name) {
      const hit = ctx.stdByName.get(ep.standard_name)
      if (hit) return hit
    }
  }
  return null
}

/** 由上下文解析某标准实际采用的功能点方法与复杂度判定矩阵（纯内存，无查库） */
export function profileFrom(ctx: BindingContext, key?: string | null): UfpProfile {
  const d = ctx.defaults
  const standardId = resolveStandardId(ctx, key)
  const bm = standardId ? ctx.bmByStandardId.get(standardId) : undefined

  let methodCode: string | null = bm?.algorithm || null
  let rulesOverride: any = null

  if (bm?.complexityRules) {
    let parsed: any = bm.complexityRules
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch (e: any) {
        fail(`标准「${standardId}」的复杂度判定矩阵不是合法 JSON：${e.message}`)
      }
    }
    const problems = validateComplexityRules(parsed)
    if (problems.length) fail(`标准「${standardId}」的复杂度判定矩阵不合法：${problems.join('；')}`)
    rulesOverride = parsed
  }

  const methodKey = methodCode || d.ufpLibrary.default
  const method = d.ufpLibrary.methods[methodKey]
  if (!method) {
    fail(
      methodCode
        ? `标准「${standardId}」声明的算法「${methodCode}」在功能点方法库里不存在（可用：${Object.keys(d.ufpLibrary.methods).join('、')}）`
        : `功能点方法库的默认方法「${methodKey}」不存在`
    )
  }

  return {
    method: methodKey,
    methodLabel: method.label,
    complexityBased: method.complexityBased,
    weights: method.weights,
    rules: (rulesOverride || d.complexityRules) as ComplexityRules,
    methodSource: methodCode ? '标准声明' : '全局默认',
    rulesSource: rulesOverride ? '标准声明' : '全局默认',
    standardId,
  }
}

/** 单标准便捷入口（内部读一次上下文） */
export async function resolveUfpProfile(standardKey?: string | null): Promise<UfpProfile> {
  const ctx = await loadBindings()
  return profileFrom(ctx, standardKey)
}

/** 结构自检：绑定上下文里每个标准都能解析出合法的功能点方法（供启动自检/脚本断言） */
export function describeBinding(ctx: BindingContext, key?: string | null) {
  const p = profileFrom(ctx, key)
  return {
    method: p.method,
    methodLabel: p.methodLabel,
    complexityBased: p.complexityBased,
    methodSource: p.methodSource,
    rulesSource: p.rulesSource,
    standardId: p.standardId,
  }
}
