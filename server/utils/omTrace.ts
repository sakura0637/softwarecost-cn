import {
  deriveOmFactors,
  factorBreakdown,
  findC1Row,
  lookupQuota,
  type OmEngine,
  type OmGlobalFactors,
  type OmItemResult,
  type OmParams,
} from './omCalculator'

// ── 单行追溯（点一个金额，看它怎么来的）──────────────────────────
//
// 借鉴自外部设计文档《运维费测算系统_详细设计文档_v1.0》的「trace 快照 / 追溯抽屉」——
// 它把「任意一行金额可追溯到参数来源」当成一期验收标准之一。
//
// 为什么值得做：Excel 的老毛病就是「想知道某个数怎么来的，只能点单元格看公式，
// 且跨表跳转后丢失上下文」；数据进了系统以后，如果只给一个金额，等于把这个问题
// 从 Excel 搬到了浏览器里，没有真正解决。
//
// ⚠️ 设计要点：追溯**不重新推导**，而是读 calcOm 已经算出的那一行结果
// （usedWorkload / correctedWorkload / correctedPrice / kindCoef / stationTimeFactor / amount）。
// 全局因子则与 calcOm 共用 deriveOmFactors()，因此：
//   「追溯面板上展示的每一步」与「实际算钱用的那一步」必然同源，
//   不会出现两块代码各算各的、金额对不上还要人去查谁对谁错。
//
// 本模块是纯函数（只依赖入参），可离线断言 —— scripts/om_selftest.ts 直接调用它。

export interface TraceStep {
  /** 步骤名，如「④ 修正工作量 G = E × F」 */
  label: string
  /** 代入数字后的算式 / 取值说明 */
  detail: string
  /** 该步的结果值 */
  value?: number
  unit?: string
  /** 出处：后台参数表 / 源表单元格 / 国标条款 */
  from?: string
  /** 是否是最终结果行（页面加粗显示） */
  final?: boolean
}

export interface TraceRef {
  /** 出处原文 */
  text: string
  /** 来自哪（表名 · 列名 / 源表位置） */
  from: string
}

export interface OmRowTrace {
  engine: OmEngine
  /** 总公式（中文） */
  formula: string
  /** 代入数字后的算式 */
  substitution: string
  amount: number
  steps: TraceStep[]
  /** 该行金额依赖的权威出处清单 */
  refs: TraceRef[]
  resolved: boolean
  warn?: string
  /** 本批测算实际采用的全局因子（与金额同源） */
  factors: OmGlobalFactors
}

/** 紧凑数字：最多 maxDec 位小数，去掉多余的 0（追溯面板上不要出现 347.8215560000001） */
function num(v: unknown, maxDec = 6): string {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return String(Number(n.toFixed(maxDec)))
}

/**
 * 生成一行的完整推导链。
 *
 * @param engine 当前引擎
 * @param row    calcOm 算出的该行结果（**不要**手工拼，必须来自 calcOm，否则追溯会失真）
 * @param p      本次测算用的参数
 */
export function traceOmRow(engine: OmEngine, row: OmItemResult, p: OmParams): OmRowTrace {
  const F = deriveOmFactors(p)

  // 明确不计费的行（线缆/机柜/家具等）
  if (row.billable === false) {
    return {
      engine,
      formula: '本行标记为「不计取运维费」，金额恒为 0',
      substitution: '0',
      amount: 0,
      steps: [
        {
          label: '不计费',
          detail:
            '该设备被「设备取费映射」判定为不计费（结构件 / 线缆 / 立杆 / 吊顶 / 开关插座等本身不含运维工作量）',
          value: 0,
          unit: '元',
          from: 'om_device_c1_map.billable = false',
          final: true,
        },
      ],
      refs: [],
      resolved: true,
      factors: F,
    }
  }

  return engine === 'c1' ? traceC1(row, p, F) : traceQuota(row, p, F)
}

/** C.1 工作量法：金额 = 数量 × (E × F) × (人天单价 × I) */
function traceC1(row: OmItemResult, p: OmParams, F: OmGlobalFactors): OmRowTrace {
  const qty = Number(row.qty) || 0
  const steps: TraceStep[] = []
  const refs: TraceRef[] = []
  const unit = row.unit || '台'

  steps.push({ label: '① 数量 D', detail: `${num(qty)} ${unit}`, value: qty, unit })

  // ── E：单位工作量 ──
  const manualWorkload = row.workload != null && row.workload !== ('' as any)
  const c1row = manualWorkload ? null : findC1Row(p.c1, String(row.category_ref || '').trim())
  // ⚠️ 未匹配时**必须说清是「没匹配上」**，不能只显示「= 0 人天」——
  // 那会让人误以为是该类别的真实基准就是 0，反而掩盖了问题。
  const eDetail = manualWorkload
    ? `清单行手工覆盖值 = ${num(row.usedWorkload)} 人天/台·套·年`
    : !row.resolved
      ? `未匹配到 C.1 取费类别「${row.category_ref || '（未填）'}」→ 本行按 0 计`
        + '（在后台「设备取费映射」补一条规则或用清单行的「单位工作量」手工填值即可消除）'
      : `C.1 取费类别「${row.category_ref || '（未填）'}」= ${num(row.usedWorkload)} 人天/台·套·年`
  steps.push({
    label: '② 单位工作量 E',
    detail: eDetail,
    value: row.usedWorkload,
    unit: '人天/台·套·年',
    from: manualWorkload
      ? '清单行「单位工作量」列手工填写'
      : c1row?.source
        ? `C.1 基准表收录出处：${c1row.source}`
        : '后台「运维参数 → C.1 单位工作量基准」',
  })
  if (c1row?.source) refs.push({ text: c1row.source, from: 'om_c1_benchmarks.source' })
  if (c1row?.note) refs.push({ text: c1row.note, from: 'om_c1_benchmarks.note' })
  if (!manualWorkload && !c1row && row.category_ref) {
    refs.push({
      text: `类别「${row.category_ref}」未精确命中基准表，可能走了模糊匹配（去掉「借」前缀 / 归一化包含）`,
      from: 'omCalculator.findC1Row',
    })
  }

  // ── F：工作量调整因子 ──
  const wf = factorBreakdown(p, 'c1_workload')
  steps.push({
    label: '③ 工作量调整因子 F',
    detail: wf.length
      ? `${wf.map((x) => `${x.name}${num(x.value, 4)}`).join(' × ')} = ${num(F.workloadFactor)}`
      : '该组无「连乘」因子，取 1',
    value: F.workloadFactor,
    from: '后台「运维参数 → 调整因子」工作量调整因子组（GB/T 28827.7-2022 附录 A）',
  })
  if (wf.length) {
    refs.push({
      text: wf.map((x) => `${x.name}=${num(x.value, 4)}`).join('；'),
      from: 'om_factors（工作量调整因子组）',
    })
  }

  // ── G：修正工作量 ──
  steps.push({
    label: '④ 修正工作量 G = E × F',
    detail: `${num(row.usedWorkload)} × ${num(F.workloadFactor)} = ${num(row.correctedWorkload)}`,
    value: row.correctedWorkload,
    unit: '人天/台·套·年',
  })

  // ── 人天单价 ──
  steps.push({
    label: '⑤ 人天单价',
    detail: p.wage
      ? `${num(p.wage.monthly_wage, 4)} 元/月 ÷ ${num(p.wage.work_days, 4)} 天 = ${num(F.dailyRate, 4)} 元/人天`
      : `${num(F.dailyRate, 4)} 元/人天（未取到人工成本基数）`,
    value: F.dailyRate,
    unit: '元/人天',
    from: p.wage?.source || '后台「运维参数 → 人工成本基数」（C.1 法锚点行）',
  })
  if (p.wage?.source) refs.push({ text: p.wage.source, from: 'om_wage_base.source' })
  if (p.wage?.note) refs.push({ text: p.wage.note, from: 'om_wage_base.note' })

  // ── I：价格调整因子 ──
  const pp = factorBreakdown(p, 'c1_price')
  const priceFactor = F.staffCoef * F.basePriceFactor * row.stationTimeFactor
  steps.push({
    label: '⑥ 价格调整因子 I',
    detail:
      `人员配备系数 ${num(F.staffCoef)} × 服务级别因子 ${num(F.basePriceFactor)}` +
      ` × 站点服务时间系数 ${num(row.stationTimeFactor, 4)} = ${num(priceFactor)}`,
    value: priceFactor,
    from: '后台「运维参数 → 调整因子」（人员配备等级 / 价格调整 / 站点类型）',
  })
  if (pp.length) {
    refs.push({
      text: `服务级别因子 = ${pp.map((x) => `${x.name}${num(x.value, 4)}`).join(' × ')} = ${num(F.basePriceFactor)}`,
      from: 'om_factors（价格调整因子组）',
    })
  }
  if (row.stationTimeFactor !== 1) {
    refs.push({
      text: `站点「${row.station || '（未选站点）'}」的服务时间系数为 ${num(row.stationTimeFactor, 4)}（7×24 值守站点会大于 1）`,
      from: 'om_station_types.time_factor',
    })
  }

  // ── J：修正单价 ──
  steps.push({
    label: '⑦ 修正单价 J = 人天单价 × I',
    detail: `${num(F.dailyRate, 4)} × ${num(priceFactor)} = ${num(row.correctedPrice)}`,
    value: row.correctedPrice,
    unit: '元/人天',
  })

  // ── 金额 ──
  const substitution = `${num(qty)} × ${num(row.correctedWorkload)} × ${num(row.correctedPrice)} = ${num(row.amount, 2)}`
  steps.push({
    label: '⑧ 金额 K = 数量 D × G × J',
    detail: `${substitution} 元`,
    value: row.amount,
    unit: '元',
    final: true,
  })

  return {
    engine: 'c1',
    formula: '金额 = 数量 × 修正工作量 × 修正单价　（修正工作量 = E × F，修正单价 = 人天单价 × I）',
    substitution,
    amount: row.amount,
    steps,
    refs,
    resolved: row.resolved,
    warn: row.warn,
    factors: F,
  }
}

/** 定额单价法：金额 = 数量 × 定额值 × 年·月换算系数 × 类别系数 [× 点位数] */
function traceQuota(row: OmItemResult, p: OmParams, F: OmGlobalFactors): OmRowTrace {
  const qty = Number(row.qty) || 0
  const steps: TraceStep[] = []
  const refs: TraceRef[] = []
  const unit = row.unit || '台'
  const qr = lookupQuota(p.quota, row.quota_ref)
  const manualQuota = row.quota_value != null && row.quota_value !== ('' as any)

  steps.push({ label: '① 数量 D', detail: `${num(qty)} ${unit}`, value: qty, unit })

  // ── 定额值 ──
  let quotaDetail: string
  if (manualQuota) {
    quotaDetail = `清单行手工覆盖值 = ${num(row.usedQuota)} 元`
  } else if (qr) {
    quotaDetail = `定额条目「${qr.name}」= ${num(row.usedQuota)} 元`
    // 只讲中文说明；**不回退显示后台的变量式**（month_wage/176*fp_coef）——
    // 追溯面板是给人看的，露出变量名就等于把「天书」又搬回来一次
    const fDesc = qr.formula_text || '（该条目的中文计算说明尚未生成，可在后台补填）'
    if (qr.formula) {
      quotaDetail += row.quotaByFormula
        ? `　（按后台推导式现算：${fDesc}）`
        : `　（后台推导式「${fDesc}」求值失败，已回退到库中固定值）`
    } else {
      quotaDetail += '　（固定值，不随后台参数联动）'
    }
  } else {
    quotaDetail = `未匹配到定额条目「${row.quota_ref || '（未填）'}」，本行按 0 计`
  }
  steps.push({
    label: '② 定额值',
    detail: quotaDetail,
    value: row.usedQuota,
    unit: '元',
    from: qr?.source || (manualQuota ? '清单行「定额值」列手工填写' : '后台「运维参数 → 定额单价库」'),
  })
  if (qr?.source) refs.push({ text: qr.source, from: 'om_quota_items.source' })
  if (qr?.formula_raw) refs.push({ text: qr.formula_raw, from: '源表原始 Excel 公式' })
  if (qr?.note) refs.push({ text: qr.note, from: 'om_quota_items.note' })

  // ── 年·月换算 ──
  steps.push({
    label: '③ 年·月换算系数',
    detail: `${num(F.monthFactor)}　（定额库中大部分条目本身已是「年额 ÷ 12」后的月单价，此处再按源表口径换算）`,
    value: F.monthFactor,
    from: '后台「运维参数 → 调整因子」年·月换算系数',
  })

  // ── 类别系数 ──
  const kind = qr?.kind || (row.kind as string) || '硬件'
  steps.push({
    label: '④ 类别系数',
    detail:
      `定额条目类别为「${kind}」→ 取${kind === '软件' ? '软件' : '硬件'}取费调整系数 ${num(row.kindCoef)}` +
      `（软件系数仅 PLC应用系统 / UNITY PRO 两类走，其余 747 种一律走硬件系数）`,
    value: row.kindCoef,
    from: '后台「运维参数 → 调整因子」定额法全局系数',
  })
  refs.push({
    text: `硬件取费调整系数 ${num(F.hardCoef)}；软件取费调整系数 ${num(F.softCoef)}`,
    from: 'om_factors（定额法全局系数）',
  })

  // ── 点位数（按功能点计价） ──
  const pointBased = qr?.point_based === true
  if (pointBased) {
    steps.push({
      label: '⑤ 点位数',
      detail:
        `${num(row.usedPointCount)} 个点位` +
        (row.usedPointCount ? '（该条目按功能点计价，必须再乘点位数）' : '（未填点位数 → 本行按 0 计）'),
      value: row.usedPointCount,
      unit: '个',
      from: '清单行「点位数」列（源表 J = I × E × G16 × 点位数 × 12）',
    })
  }

  const parts = [num(qty), num(row.usedQuota), num(F.monthFactor), num(row.kindCoef)]
  if (pointBased) parts.push(num(row.usedPointCount))
  const substitution = `${parts.join(' × ')} = ${num(row.amount, 2)}`

  steps.push({
    label: pointBased ? '⑥ 金额 = D × 定额值 × 换算系数 × 类别系数 × 点位数' : '⑤ 金额 = D × 定额值 × 换算系数 × 类别系数',
    detail: `${substitution} 元`,
    value: row.amount,
    unit: '元',
    final: true,
  })

  return {
    engine: 'quota',
    formula: pointBased
      ? '金额 = 数量 × 定额值 × 年·月换算系数 × 类别系数 × 点位数'
      : '金额 = 数量 × 定额值 × 年·月换算系数 × 类别系数',
    substitution,
    amount: row.amount,
    steps,
    refs,
    resolved: row.resolved,
    warn: row.warn,
    factors: F,
  }
}
