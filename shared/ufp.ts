// 功能点计量的纯逻辑（无 DB 依赖）——服务端与工作台共用同一份实现，
// 保证「前端预览的 UFP」与「后端入库的 UFP」永远一致。
//
// ⚠️ 这里只放算法，不放任何领域参数：权值、判定阈值一律由调用方从数据库传入。
//    参数从哪来见 server/utils/pricingParams.ts（唯一取数出口）。

export type Complexity = '低' | '中' | '高'
export const COMPLEXITIES: Complexity[] = ['低', '中', '高']

/** 一类功能点的复杂度判定档位：行档 × 列档 → 复杂度 */
export interface ComplexityBand {
  /** 行档下界（升序）。ILF/EIF 行=RET；EI/EO/EQ 行=FTR */
  rowBands: number[]
  /** 列档下界（升序）。一律为 DET */
  colBands: number[]
  rowLabel?: string
  colLabel?: string
  /** matrix[行档][列档] = 低|中|高 */
  matrix: Complexity[][]
}
export type ComplexityRules = Record<string, ComplexityBand>

/** 一套功能点方法：按复杂度取值（详细功能点法）或只按类型取值（快速/全功能点法） */
export interface UfpMethod {
  label: string
  complexityBased: boolean
  weights: Record<string, number | Record<string, number>>
}

/** 判定一个值落在第几档（返回最后一个「下界 ≤ 值」的档位下标）；空档返回 -1 */
export function bandIndex(bands: number[], v: number): number {
  if (!Array.isArray(bands) || !bands.length) return -1
  let idx = -1
  for (let i = 0; i < bands.length; i++) if (v >= Number(bands[i])) idx = i
  return idx
}

/**
 * 由 RET / DET / FTR 判定复杂度。
 * ILF/EIF 看 RET×DET，EI/EO/EQ 看 FTR×DET —— 这一点由矩阵每类的 rowBands 承载，
 * 函数本身只按类型分流「行取哪个值」。
 * 判定不出来（类型未知 / 矩阵不合法）返回 null，调用方须显式处理，不得悄悄当'中'。
 */
export function classifyComplexity(
  rules: ComplexityRules | null | undefined,
  type: string,
  ret: number,
  det: number,
  ftr: number
): Complexity | null {
  const band = rules?.[(type || '').toUpperCase()]
  if (!band) return null
  const rowVal = type === 'ILF' || type === 'EIF' ? Number(ret) || 0 : Number(ftr) || 0
  const ri = bandIndex(band.rowBands, rowVal)
  const ci = bandIndex(band.colBands, Number(det) || 0)
  if (ri < 0 || ci < 0) return null
  const v = band.matrix?.[ri]?.[ci]
  return v && COMPLEXITIES.includes(v) ? v : null
}

/** 取一个功能点的权值（UFP 贡献）。取不到返回 null，不返回 0 —— 0 会被误当成"算出来就是 0"。
 *  入参接受任何带 complexityBased + weights 的对象（方法本身、或解析层下发的 profile）。 */
export function ufpWeightOf(
  method: { complexityBased?: boolean; weights?: Record<string, any> } | null | undefined,
  type: string,
  complexity: string
): number | null {
  const w = method?.weights?.[(type || '').toUpperCase()]
  if (w == null) return null
  const raw = method!.complexityBased ? (w as Record<string, number>)[complexity] : (w as number)
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 矩阵结构自检：返回问题清单（空数组 = 合法）。库里的值被人改坏时必须当场报出来。 */
export function validateComplexityRules(rules: any): string[] {
  const bad: string[] = []
  if (!rules || typeof rules !== 'object') return ['复杂度判定矩阵为空或不是对象']
  for (const t of ['ILF', 'EIF', 'EI', 'EO', 'EQ']) {
    const b = rules[t]
    if (!b) {
      bad.push(`缺少 ${t} 的判定档位`)
      continue
    }
    if (!Array.isArray(b.rowBands) || !b.rowBands.length) bad.push(`${t}.rowBands 不是非空数组`)
    if (!Array.isArray(b.colBands) || !b.colBands.length) bad.push(`${t}.colBands 不是非空数组`)
    if (!Array.isArray(b.matrix)) {
      bad.push(`${t}.matrix 不是数组`)
      continue
    }
    if (b.matrix.length !== (b.rowBands?.length ?? 0)) {
      bad.push(`${t}.matrix 行数 ${b.matrix.length} ≠ rowBands 档数 ${b.rowBands?.length}`)
    }
    for (let i = 0; i < b.matrix.length; i++) {
      const row = b.matrix[i]
      if (!Array.isArray(row) || row.length !== (b.colBands?.length ?? 0)) {
        bad.push(`${t}.matrix 第 ${i + 1} 行列数 ≠ colBands 档数 ${b.colBands?.length}`)
        continue
      }
      for (const v of row) if (!COMPLEXITIES.includes(v)) bad.push(`${t}.matrix 含非法值「${v}」`)
    }
  }
  return bad
}

/** 方法库结构自检（返回问题清单） */
export function validateUfpMethods(methods: any): string[] {
  const bad: string[] = []
  if (!methods || typeof methods !== 'object' || !Object.keys(methods).length) {
    return ['功能点方法库为空']
  }
  for (const [code, m] of Object.entries<any>(methods)) {
    if (!m?.label) bad.push(`方法 ${code} 缺 label`)
    if (typeof m?.complexityBased !== 'boolean') bad.push(`方法 ${code} 缺 complexityBased（true/false）`)
    if (!m?.weights || typeof m.weights !== 'object') {
      bad.push(`方法 ${code} 的 weights 为空`)
      continue
    }
    for (const [t, w] of Object.entries<any>(m.weights)) {
      if (!['ILF', 'EIF', 'EI', 'EO', 'EQ'].includes(t)) bad.push(`方法 ${code} 含未知类型 ${t}`)
      if (m.complexityBased) {
        for (const c of COMPLEXITIES) if (!Number.isFinite(Number(w?.[c]))) bad.push(`方法 ${code}.${t} 缺「${c}」档权值`)
      } else if (!Number.isFinite(Number(w))) {
        bad.push(`方法 ${code}.${t} 权值不是数字`)
      }
    }
  }
  return bad
}
