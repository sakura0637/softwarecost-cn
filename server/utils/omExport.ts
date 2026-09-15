import * as XLSX from 'xlsx'
import type { OmCostLine, OmParams, OmQuotaRow, OmResult } from './omCalculator'

// 运维测算导出工作簿（4 个 sheet）。
//
// 设计原则：**导出即自解释**。这份 Excel 离开系统后，收到的人不必再回后台翻参数，
// 就能回答三个问题：「这个金额怎么算出来的」「用的是哪一套参数」「谁在什么时候导的」。
// 所以除了金额，还把「参数与出处」整张表一并带走，每个 sheet 页脚都带版本/时间/导出人。
//
// ⚠️ 金额一律**按原始精度写入单元格**，只套显示格式（2 位小数），不做四舍五入后落值。
//    这样 Excel 里 SUM 出来的合计＝真实合计（与系统内「先加总后舍入」口径一致）；
//    若写入前先舍入，就会出现「逐行舍入再相加」的系统性偏差 —— 正是源表对账时最容易被质疑的点。

export interface OmExportInfo {
  /** 项目/测算名称（存档导出时用存档名） */
  projectName?: string | null
  /** 清单来源中文名，如「设备价格库」「示例清单」 */
  sourceLabel?: string | null
  /** 站点范围描述，如「全选（10 个管理处 / 170 个子站）」 */
  siteLabel?: string | null
  operatorName?: string | null
  createdAt?: Date
  /** 参数集版本标注，如「存档 #12（快照）」「当前生效参数」 */
  paramVersion?: string | null
}

const MONEY = '#,##0.00'
const DEC4 = '0.0000'
const DEC6 = '0.000000'
const INT = '0.####'

/** 给指定列的数值单元格套显示格式（只改显示，不改存储值） */
function applyFormat(ws: XLSX.WorkSheet, colFormats: Record<number, string>) {
  const ref = ws['!ref']
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  for (const [colStr, z] of Object.entries(colFormats)) {
    const c = Number(colStr)
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number' && Number.isFinite(cell.v)) cell.z = z
    }
  }
}

function makeSheet(rows: any[][], widths: number[], colFormats: Record<number, string> = {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map((w) => ({ wch: w }))
  applyFormat(ws, colFormats)
  return ws
}

function fmtTime(d?: Date): string {
  const dt = d || new Date()
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(dt).replace(/\//g, '-')
  } catch {
    return dt.toISOString()
  }
}

/** 每个 sheet 末尾的统一页脚（版本 / 时间 / 导出人 / 舍入口径） */
function footer(info: OmExportInfo, extra?: string): any[] {
  const parts = [
    '本表由「水网数智造价系统」导出',
    `导出时间 ${fmtTime(info.createdAt)}`,
    `导出人 ${info.operatorName || '—'}`,
    `参数版本 ${info.paramVersion || '当前生效参数'}`,
  ]
  if (extra) parts.push(extra)
  parts.push('金额按原始精度计算、仅显示保留 2 位小数（与 Excel 先加总后舍入口径一致）')
  return parts
}

function pushFooter(rows: any[][], info: OmExportInfo, extra?: string) {
  rows.push([])
  // ⚠️ 必须 join 成**一个单元格** —— 直接把 string[] 当行 push 会让页脚铺成一整排列，
  // 在「设备明细」这种已有固定列数的表里还会多出几列，导出文件看起来会很乱。
  rows.push([footer(info, extra).join('　｜　')])
}

// ── Sheet 1：费用汇总 ────────────────────────────────────────────
function sheetSummary(result: OmResult, params: OmParams, info: OmExportInfo): XLSX.WorkSheet {
  const m = result.meta
  const items = result.items
  const unresolvedN = items.filter((x) => !x.resolved).length
  const unbilledN = items.filter((x) => x.billable === false).length

  const aoa: any[][] = []
  aoa.push([info.projectName || '运维费用测算表'])
  aoa.push([])

  aoa.push(['一、测算基本信息'])
  aoa.push(['测算引擎', m.engineLabel || result.engine])
  aoa.push(['设备清单来源', info.sourceLabel || '—'])
  aoa.push(['站点范围', info.siteLabel || '—'])
  aoa.push(['清单行数', items.length])
  aoa.push(['其中：未匹配（按 0 计）行数', unresolvedN])
  aoa.push(['其中：明确不计费行数', unbilledN])
  aoa.push(['合计人天（C.1 法）', result.totalPersonDays])
  aoa.push([])

  aoa.push(['二、计价参数'])
  aoa.push(['人工成本基数', m.wageBaseLabel])
  if (result.engine === 'c1') {
    aoa.push(['人天单价(元/人天) = 月工资 ÷ 月计薪天数', m.dailyRate])
    aoa.push(['工作量调整因子（连乘）', m.workloadFactor])
    aoa.push(['价格调整因子（服务周期×频率×生存周期）', m.basePriceFactor])
    aoa.push(['人员配备系数（等级加权）', m.staffCoef])
    aoa.push(['生效价格因子 = 人员配备系数 × 价格调整因子', m.priceFactor])
  } else {
    aoa.push(['硬件取费调整系数', m.hardCoef])
    aoa.push(['软件取费调整系数', m.softCoef])
    aoa.push(['年·月换算系数', m.monthFactor])
    aoa.push(['定额法工资锚点(元/月)', params.quotaWage ? Number(params.quotaWage.monthly_wage) : ''])
    for (const [k, v] of Object.entries(m.quotaVars || {})) {
      const label: Record<string, string> = {
        month_wage: '推导式变量·月工资基数(元)',
        fp_coef: '推导式变量·功能点系数',
        wage_ratio: '推导式变量·运维单价调整系数',
        months: '推导式变量·月份数',
      }
      aoa.push([label[k] || `推导式变量·${k}`, v])
    }
  }
  aoa.push([])

  aoa.push(['三、费用构成'])
  aoa.push(['费用项目', '计费基数', '费率', '金额(元)'])
  const costRow = (label: string, base: string, rate: string, amount: number) => [label, base, rate, amount]
  const rateText = (l: OmCostLine) => (l.unit === 'ratio' ? `${(Number(l.rate) * 100).toFixed(2)}%` : `${l.rate} ${l.unit}`)

  aoa.push(costRow(result.engine === 'c1' ? '人工费（明细金额合计）' : '直接运维费（明细金额合计）', '—', '—', result.laborCost))
  for (const l of result.otherDirect) aoa.push(costRow(l.label, l.base, rateText(l), l.amount))
  aoa.push(costRow('其他直接费小计', '—', '—', result.otherDirectTotal))
  if (result.mgmtService) {
    aoa.push(costRow(result.mgmtService.label, result.mgmtService.base, rateText(result.mgmtService), result.mgmtService.amount))
  }
  aoa.push(costRow('直接费小计', '—', '—', result.directSubtotal))
  aoa.push(costRow('直接费合计（含管理服务费）', '—', '—', result.directTotal))
  for (const l of result.indirect) aoa.push(costRow(l.label, l.base, rateText(l), l.amount))
  aoa.push(costRow('间接费小计', '—', '—', result.indirectTotal))
  aoa.push(costRow('税前合计', '—', '—', result.pretax))
  if (result.tax) aoa.push(costRow(result.tax.label, result.tax.base, rateText(result.tax), result.tax.amount))
  if (result.spare) aoa.push(costRow(result.spare.label, result.spare.base, rateText(result.spare), result.spare.amount))
  for (const l of result.extra) aoa.push(costRow(l.label, l.base, rateText(l), l.amount))
  if (result.extra.length) aoa.push(costRow('其他费用小计', '—', '—', result.extraTotal))
  aoa.push([])
  aoa.push(costRow('费用总额(元)', '—', '—', result.total))

  pushFooter(aoa, info, `引擎 ${result.engine}`)
  return makeSheet(aoa, [42, 34, 14, 16], { 3: MONEY })
}

// ── Sheet 2：设备明细 ────────────────────────────────────────────
function sheetItems(result: OmResult, info: OmExportInfo): XLSX.WorkSheet {
  const aoa: any[][] = []
  const isC1 = result.engine === 'c1'

  const head = ['序号', '管理处/站点', '分类', '设备名称', '单位', '数量']
  if (isC1) {
    head.push('C.1 取费类别', '单位工作量(人天/台·套·年)', '修正工作量(人天)', '人天单价(元)', '修正单价(元)', '金额(元)', '计费', '备注')
  } else {
    head.push('定额条目', '定额值(元/月)', '类别系数', '点位数', '金额(元)', '计费', '备注')
  }
  aoa.push(head)

  result.items.forEach((it, i) => {
    const row: any[] = [i + 1, it.station || '', it.category || '', it.name, it.unit || '', it.qty]
    if (isC1) {
      row.push(
        it.category_ref || '',
        it.usedWorkload,
        it.correctedWorkload,
        result.meta.dailyRate,
        it.correctedPrice,
        it.amount,
        it.billable === false ? '否' : '是',
        it.note || ''
      )
    } else {
      row.push(
        it.quota_ref || '',
        it.usedQuota,
        it.kindCoef,
        it.usedPointCount == null ? '' : it.usedPointCount,
        it.amount,
        it.billable === false ? '否' : '是',
        it.note || ''
      )
    }
    aoa.push(row)
  })

  // 合计行：按原始精度求和（= Excel SUM 的口径）
  const totalAmount = result.items.reduce((a, x) => a + (Number(x.amount) || 0), 0)
  const totalRow: any[] = ['', '', '', '合计', '', '']
  if (isC1) {
    totalRow.push('', '', '', '', '', totalAmount, '', '')
  } else {
    totalRow.push('', '', '', '', totalAmount, '', '')
  }
  aoa.push(totalRow)

  pushFooter(aoa, info, isC1 ? 'C.1 工作量法' : '定额单价法')

  const widths = isC1 ? [6, 22, 14, 42, 6, 8, 24, 20, 16, 12, 12, 14, 6, 20] : [6, 22, 14, 42, 6, 8, 28, 14, 10, 8, 14, 6, 20]
  const fmts: Record<number, string> = { 5: INT }
  if (isC1) {
    fmts[7] = DEC4; fmts[8] = DEC4; fmts[9] = MONEY; fmts[10] = MONEY; fmts[11] = MONEY
  } else {
    fmts[7] = MONEY; fmts[8] = DEC6; fmts[9] = INT; fmts[10] = MONEY
  }
  return makeSheet(aoa, widths, fmts)
}

// ── Sheet 3：未匹配 / 不计费清单 ─────────────────────────────────
function sheetUnresolved(result: OmResult, info: OmExportInfo): XLSX.WorkSheet {
  const aoa: any[][] = []
  aoa.push(['类型', '序号', '设备名称', '管理处/站点', '引用的取费类别 / 定额条目', '原因与处理建议'])

  const isC1 = result.engine === 'c1'
  let n = 0
  result.items.forEach((it, i) => {
    if (it.resolved) return
    n++
    aoa.push([
      '未匹配（按 0 计）',
      i + 1,
      it.name,
      it.station || '',
      (isC1 ? it.category_ref : it.quota_ref) || '（空）',
      it.warn ||
        (isC1
          ? 'C.1 基准表里没有这个类别：在「数据维护 → 运维参数 → C.1 单位工作量基准」补一条，或在「设备取费映射」里把它指到已有类别'
          : '定额库里没有这个设备名：在「数据维护 → 运维参数 → 定额单价库」补一条，或在「设备取费映射」里指定定额条目名'),
    ])
  })
  if (n === 0) aoa.push(['—', '', '（无未匹配行）', '', '', ''])

  const unbilled = result.items.map((it, i) => ({ it, i })).filter((x) => x.it.billable === false)
  aoa.push([])
  aoa.push([`明确不计费行（${unbilled.length} 行，金额按 0 计、不计入未匹配）`])
  aoa.push(['序号', '设备名称', '管理处/站点', '', '', '备注'])
  for (const { it, i } of unbilled) {
    aoa.push([i + 1, it.name, it.station || '', '', '', it.note || ''])
  }

  pushFooter(aoa, info, `未匹配 ${n} 行 / 不计费 ${unbilled.length} 行`)
  return makeSheet(aoa, [18, 6, 42, 22, 30, 60])
}

// ── Sheet 4：参数与出处 ──────────────────────────────────────────
function sheetParams(params: OmParams, info: OmExportInfo): XLSX.WorkSheet {
  const aoa: any[][] = []
  aoa.push(['本表是导出时点生效的全部计价参数及出处。收到这份 Excel 的人无需再登录系统，即可核对每个数字的来源。'])
  aoa.push([])

  aoa.push(['一、人工成本基数（om_wage_base）'])
  aoa.push(['年度', '地区', '行业', '月工资(元)', '月计薪天数', '用途', '出处', '备注'])
  for (const w of params.wageBases) {
    const usage: Record<string, string> = { c1: 'C.1 法锚点', quota: '定额法锚点', ref: '仅参考（不参与计算）' }
    aoa.push([w.year ?? '', w.region || '', w.industry || '', Number(w.monthly_wage), Number(w.work_days), usage[String(w.usage)] || w.usage || '', w.source || '', w.note || ''])
  }
  aoa.push([])

  aoa.push(['二、调整因子（om_factors）——「计算方式」决定它是否真的进公式'])
  aoa.push(['因子分组', '因子名称', '取值', '单位', '适用引擎', '计算方式', '取值依据', '说明'])
  for (const f of params.factors) {
    const calc: Record<string, string> = { multiply: '连乘（参与计算）', option: '备选（不参与计算）', product: '分组合计（仅展示）', weighted: '加权平均（仅展示）' }
    aoa.push([f.group_name || f.group_key, f.name, Number(f.value), f.unit || '', f.engine, calc[String(f.calc)] || f.calc || '', f.basis || '', f.description || ''])
  }
  aoa.push([])

  aoa.push(['三、费率项（om_rate_items）——「计费基数」决定它乘在谁身上'])
  aoa.push(['费率分组', '费用项目', '费率', '单位', '计费基数', '适用引擎', '说明'])
  for (const r of params.rates) {
    aoa.push([r.group_name || r.group_key, r.name, Number(r.rate), r.unit || '', r.base_note || '', r.engine, r.description || ''])
  }
  aoa.push([])

  aoa.push(['四、C.1 单位工作量基准（om_c1_benchmarks）——「单位工作量」单位为人天/台·套·年'])
  aoa.push(['取费类别', '级别', '单位', '单位工作量', '出处', '备注'])
  for (const c of params.c1) {
    aoa.push([c.category, c.level || '', c.unit || '', Number(c.workload), c.source || '', c.note || ''])
  }
  aoa.push([])

  aoa.push(['五、定额单价库（om_quota_items）——「计算说明」是推导式的中文意思，实际取值按推导式现算'])
  aoa.push(['定额条目', '单位', '库中定额值(元)', '类别', '按点位数计价', '计算说明', '源表原始公式', '出处', '备注'])
  for (const q of params.quota as OmQuotaRow[]) {
    aoa.push([
      q.name, q.unit || '', Number(q.quota), q.kind || '',
      q.point_based ? '是' : '否',
      q.formula_text || (q.formula ? q.formula : '固定值，不随后台参数联动'),
      q.formula_raw || '',
      q.source || '', q.note || '',
    ])
  }
  aoa.push([])

  aoa.push(['六、站点类型与服务时间系数（om_station_types）'])
  aoa.push(['站点编码', '站点类型', '单位', '数量', '服务时间系数', '对应源表工作表'])
  for (const s of params.stations) {
    aoa.push([s.code, s.name, s.unit || '', Number(s.qty), Number(s.time_factor), s.sheet_name || ''])
  }

  pushFooter(aoa, info)
  return makeSheet(aoa, [30, 30, 26, 18, 20, 24, 34, 44, 30], { 3: MONEY })
}

// ── 组装 ────────────────────────────────────────────────────────
export function buildOmWorkbook(result: OmResult, params: OmParams, info: OmExportInfo): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheetSummary(result, params, info), '费用汇总')
  XLSX.utils.book_append_sheet(wb, sheetItems(result, info), '设备明细')
  XLSX.utils.book_append_sheet(wb, sheetUnresolved(result, info), '未匹配清单')
  XLSX.utils.book_append_sheet(wb, sheetParams(params, info), '参数与出处')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
