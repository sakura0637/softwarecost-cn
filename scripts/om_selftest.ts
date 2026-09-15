// 离线验证：用种子参数 + 示例清单跑一遍双引擎，与源表口径对数
import { calcOm, quotaValueOf, lookupQuota, lookupC1, type OmParams, type OmItemInput } from '../server/utils/omCalculator'
import { traceOmRow } from '../server/utils/omTrace'
import { buildOmWorkbook } from '../server/utils/omExport'
import { diffParams } from '../server/utils/omSnapshot'
import * as XLSX from 'xlsx'
import { matchDevice, matchC1Rule, matchQuotaItem, buildQuotaIndex,
  buildSiteTree, parseSiteSelection, buildSiteWhere, countSelectedRows,
} from '../server/utils/omDeviceMatcher'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  omWageBases, omFactors, omRateItems, omC1Benchmarks, omQuotaItems,
  omStationTypes, omSampleItems, omDeviceC1Maps,
} from '../server/seed/omData'

const wage = omWageBases.find((w) => w.is_default)!
const quotaWage = omWageBases.find((w) => w.usage === 'quota')!
const fv = (name: string, def: number) => {
  const f = omFactors.find((x) => x.group_key === 'quota_global' && x.name === name)
  return f ? Number(f.value) : def
}
const quotaVars: Record<string, number> = {
  month_wage: quotaWage.monthly_wage,
  fp_coef: fv('功能点调整系数', 0.1),
  wage_ratio: fv('运维单价调整系数', 1),
  months: fv('年·月换算系数', 12),
}

const params: OmParams = {
  wageBases: omWageBases as any,
  wage: wage as any,
  dailyRate: (wage as any).monthly_wage / (wage as any).work_days,
  quotaWage: quotaWage as any,
  factors: omFactors.map((f, i) => ({ id: i + 1, ...f })) as any,
  // 模拟 loadOmParams 的 WHERE is_active = true
  rates: omRateItems.filter((r) => r.is_active !== false).map((r, i) => ({ id: i + 1, ...r })) as any,
  c1: omC1Benchmarks.map((c, i) => ({ id: i + 1, ...c })) as any,
  quota: omQuotaItems.map((q, i) => ({ id: i + 1, ...q })) as any,
  stations: omStationTypes.map((s, i) => ({ id: i + 1, ...s })) as any,
  quotaVars,
}

console.log('人天单价 =', params.dailyRate.toFixed(6), '元/人天')
console.log('定额法月人工费 =', quotaVars.month_wage, '元/月（源表 定额!D3 = 136833/12）')
console.log('定额推导变量 =', JSON.stringify(quotaVars))
console.log('')

// ── C.1 引擎：示例清单（按站点数量放大）──
const stOf = (name: string) => omStationTypes.find((s) => s.name === name || s.sheet_name === name)
const items: OmItemInput[] = omSampleItems.map((it) => {
  const st = stOf(it.station)
  return {
    name: it.name,
    station: st?.name || it.station,
    category: it.category,
    sheet_no: it.sheet_no,
    unit: it.unit,
    qty: it.qty * (st?.qty ?? 1),
    category_ref: it.category_ref,
    workload: it.billable ? it.workload : null,
    billable: it.billable,
  }
})

const r1 = calcOm('c1', items, params)
console.log('══ C.1 工作量法 ══')
console.log('  明细行         =', items.length)
console.log('  工作量因子     =', r1.meta.workloadFactor)
console.log('  人员配备系数   =', r1.meta.staffCoef)
console.log('  价格因子(基础) =', r1.meta.basePriceFactor)
console.log('  合计修正工作量 =', r1.totalPersonDays.toFixed(2), '人天')
console.log('  人工费         =', r1.laborCost.toFixed(2))
console.log('  其他直接费小计 =', r1.otherDirectTotal.toFixed(2),
  '（' + r1.otherDirect.map((l) => `${l.label}@${l.base}`).join(' / ') + '）')
console.log('  直接费         =', r1.directTotal.toFixed(2))
console.log('  间接费         =', r1.indirectTotal.toFixed(2),
  '（' + r1.indirect.map((l) => `${l.label}@${l.base}`).join(' / ') + '）')
console.log('  税金           =', (r1.tax?.amount || 0).toFixed(2), '基数=', r1.tax?.base)
console.log('  备品备件       =', (r1.spare?.amount || 0).toFixed(2), r1.spare ? '' : '（未启用）')
console.log('  合计           =', (r1.total / 10000).toFixed(2), '万元')
console.log('  未匹配行数     =', r1.items.filter((x) => !x.resolved).length)
const picks = ['200kVA UPS主机（双机并联冗余）', '数据库软件', '48口交换机', '室内网络摄像机']
for (const p of picks) {
  const s = r1.items.find((x) => x.name.includes(p.slice(0, 8)))
  if (s) {
    console.log(`  抽查「${s.name.slice(0, 18)}」 站点=${s.station} 数量=${s.qty} E=${s.usedWorkload}` +
      ` 工作量因子后=${s.correctedWorkload.toFixed(4)} 单价=${s.correctedPrice.toFixed(4)} 时间系数=${s.stationTimeFactor} 金额=${s.amount.toFixed(2)}`)
  }
}
const itemsOne = omSampleItems.map((it) => {
  const st = stOf(it.station)
  return {
    name: it.name, station: st?.name || it.station, qty: it.qty,
    category_ref: it.category_ref, workload: it.billable ? it.workload : null, billable: it.billable,
  } as OmItemInput
})
const r1b = calcOm('c1', itemsOne, params)
console.log('  [单站口径] 直接费 =', r1b.directTotal.toFixed(2), ' 合计 =', (r1b.total / 10000).toFixed(2), '万元')
console.log('  [单站口径] 工作量 =', r1b.totalPersonDays.toFixed(2), '人天')
console.log('')

// ── 定额引擎：取示例清单里的设备名去定额库匹配 ──
// 注：不再硬编码 kind —— 类别以定额库中该条目的 kind 为准（源表实测结论）
const itemsQ: OmItemInput[] = omSampleItems.map((it) => ({
  name: it.name,
  station: it.station,
  qty: it.qty,
  quota_ref: it.name,
}))
const r2 = calcOm('quota', itemsQ, params)
console.log('══ 定额单价法 ══')
console.log('  明细行       =', itemsQ.length)
console.log('  直接运维费   =', r2.laborCost.toFixed(2))
console.log('  税金         =', (r2.tax?.amount || 0).toFixed(2), '基数=', r2.tax?.base)
console.log('  备品备件     =', (r2.spare?.amount || 0).toFixed(2), '基数=', r2.spare?.base)
console.log('  暂列金       =', r2.extraTotal.toFixed(2), r2.extra.length ? '' : '（未启用）')
console.log('  合计         =', (r2.total / 10000).toFixed(2), '万元')
console.log('  未匹配行数   =', r2.items.filter((x) => !x.resolved).length)
const q1 = r2.items.find((x) => x.name.includes('UPS'))
console.log('  抽查 UPS(3KVA)：定额=' + q1?.usedQuota + ' 系数=' + q1?.kindCoef + ' 金额=' + q1?.amount?.toFixed(2))
const unmatched = r2.items.filter((x) => !x.resolved).map((x) => x.name)
console.log('  未匹配样例:', unmatched.slice(0, 12))
console.log('')

// ── 软件条目（按功能点计价）专项：源表 定兴县管理站 J26 = 8052.40 ──
const softItems: OmItemInput[] = [
  { name: 'PLC应用系统', station: '管理处监控中心', qty: 1, quota_ref: 'PLC应用系统', point_count: 73 },
]
const rSoft = calcOm('quota', softItems, params)
const soft = rSoft.items[0]
console.log('══ 软件条目（按功能点计价）══')
console.log(`  PLC应用系统 73 点位：定额=${soft.usedQuota.toFixed(6)}（${soft.quotaByFormula ? '公式现算' : '固定值'}）` +
  ` 系数=${soft.kindCoef} 点位数=${soft.usedPointCount} 金额=${soft.amount.toFixed(2)}`)
console.log(`  源表 保定管理处定兴县管理站 J26 = 8052.40`)
// 缺点位数的情形
const rSoftNoPt = calcOm('quota', [{ name: 'PLC应用系统', qty: 1, quota_ref: 'PLC应用系统' } as OmItemInput], params)
console.log(`  未填点位数：金额=${rSoftNoPt.items[0].amount.toFixed(2)} resolved=${rSoftNoPt.items[0].resolved}` +
  ` 提示="${rSoftNoPt.items[0].warn || ''}"`)
console.log('')

// ── 设备价格库取费匹配（测算页「按管理处载入真实台账」的核心）──
const rules = omDeviceC1Maps as any[]
const quotaIndex = buildQuotaIndex(omQuotaItems as any)

console.log('══ 设备价格库取费匹配 ══')
console.log(`  映射规则 ${rules.length} 条（精确名 ${rules.filter((r) => r.match_type === 'name').length}` +
  ` / 关键词 ${rules.filter((r) => r.match_type === 'keyword').length}）`)

const devSeedFile = join(process.cwd(), 'server', 'seed', 'device_prices_seed.json')
let devRows: any[] = []
if (existsSync(devSeedFile)) {
  try { devRows = JSON.parse(readFileSync(devSeedFile, 'utf-8')) } catch { devRows = [] }
}
let devQuotaHit = 0
let devC1Hit = 0
for (const r of devRows) {
  const m = matchDevice(r.name, quotaIndex, rules, 'quota')
  if (m.quota_ref) devQuotaHit++
  if (matchC1Rule(r.name, rules)?.c1_category) devC1Hit++
}
if (devRows.length) {
  console.log(`  设备库 ${devRows.length} 行 → 定额法可匹配 ${devQuotaHit} 行（${(devQuotaHit / devRows.length * 100).toFixed(1)}%）` +
    `、C.1 法可映射 ${devC1Hit} 行（${(devC1Hit / devRows.length * 100).toFixed(1)}%）`)
}

const c1of = (n: string) => matchC1Rule(n, rules)?.c1_category || ''
const mapCases: Array<[string, string]> = [
  ['双电源进线屏（GCS）', '借UPS中值'],
  ['UPS配电柜', '借UPS中值'],
  ['UPS电源(3KVA)', 'UPS五级'],
  ['工业交换机（不配光模块）', '交换机'],
  ['精密空调', '精密空调'],
  ['精密空调隔离开关箱（内装63A隔离开关一个，自动空气开关2个）', ''],
  ['非冗余PLC控制柜（含柜内温湿度控制器、中间继电器、声光报警装置等）', ''],
  ['服务器机架', ''],
]
for (const [n, want] of mapCases) {
  const got = c1of(n)
  console.log(`  ${got === want ? '✓' : '✗'} 「${n.slice(0, 24)}」→ ${got || '(未匹配)'}` +
    (got === want ? '' : `，期望 ${want || '(未匹配)'}`))
}
const q1st = matchQuotaItem('UPS电源(3KVA)', omQuotaItems as any)
console.log(`  定额匹配「UPS电源(3KVA)」→ ${q1st ? q1st.row.name + '（' + q1st.how + '）' : '(未匹配)'}`)
console.log('')

// ── 站点筛选（管理处 → 子站 两级多选；测算页「选择站点」弹窗的数据基础）──
// 设备库种子里没有 is_summary 字段，它由 deviceSeed.ts 按子站名判定：
// 子站名为「全站设备汇总」且管理处不是总调中心 → 是重复的汇总行，必须排除。
// 总调中心没有真实子站，它的「全站设备汇总」就是本站明细，必须保留。
const treeRows = devRows.map((r: any) => ({
  station: r.station,
  subsite: r.subsite,
  is_summary: r.subsite === '全站设备汇总' && r.station !== '总调中心',
}))
const siteTree = buildSiteTree(treeRows)
const allRows = siteTree.reduce((a, n) => a + n.count, 0)
const sjz = siteTree.find((n) => n.station === '石家庄')
const zdzx = siteTree.find((n) => n.station === '总调中心')

console.log('══ 站点筛选 ══')
console.log(`  管理处 ${siteTree.length} 个 · 子站 ${siteTree.reduce((a, n) => a + n.subsites.length, 0)} 个 · 设备 ${allRows} 行`)
console.log(`  石家庄 ${sjz?.count} 行 / ${sjz?.subsites.length} 个子站；总调中心 ${zdzx?.count} 行（其汇总站=本站明细，保留）`)

const sel = parseSiteSelection('石家庄::正定管理站,邢台::*')
console.log(`  解析「石家庄::正定管理站,邢台::*」→ ${sel.map((s) => `${s.station}/${s.subsite}`).join(' + ')}` +
  ` = ${countSelectedRows(sel, siteTree)} 行`)
const selWhere = buildSiteWhere(sel)
console.log(`  WHERE ${selWhere.sql}  params=${JSON.stringify(selWhere.params)}`)
console.log(`  空选择（全选）→ ${countSelectedRows([], siteTree)} 行；非法转义不崩：` +
  `${JSON.stringify(parseSiteSelection('%E4%B8%8D%E5%90%88%E6%B3%95%'))}`)
console.log('')

// ── 定额公式的中文说明（数据维护页「计算说明」列）──
const ftext = omQuotaItems.map((q) => q.formula_text || '')
const ftextUniq = [...new Set(ftext)]
const hasLatin = ftext.filter((t) => /[a-z_]{3,}/.test(t))
console.log('══ 定额公式中文说明 ══')
console.log(`  ${omQuotaItems.length} 条全部有说明：${ftext.every(Boolean)}；不同说明 ${ftextUniq.length} 种`)
console.log(`  含英文变量名（天书）的说明：${hasLatin.length} 条`)
console.log(`  示例：${omQuotaItems.find((q) => q.name === '站控应用系统')?.formula_text}`)
console.log(`        ${omQuotaItems.find((q) => q.name === 'UPS电源(3KVA)')?.formula_text}`)
console.log(`        固定值条目：${omQuotaItems.find((q) => !q.formula)?.formula_text}`)
console.log('')

// ── 查找缓存（大清单测算的性能关键，但绝不能改变结果）──
// 设备库全量 8452 行里同名设备重复出现几十次，而 lookupQuota 是 349 条定额的全表扫描
// （未命中时最多探 4 轮 + 反复算归一化名）。加记忆化后定额法 8452 行 1042ms → ~40ms，
// 最坏情况（全部未命中）3852ms → ~33ms。这里锁住两点：**结果不变** + **重复 ref 真正复用**。
const quotaRefs = [omQuotaItems[0].name, omQuotaItems[5].name, '完全不存在的设备名XYZ', omQuotaItems[0].name]
const c1Refs = [omC1Benchmarks[0].category, '借' + omC1Benchmarks[3].category, '完全不存在的类别XYZ']

const qCache = new Map<string, any>()
const cCache = new Map<string, number | null>()
const qSame = quotaRefs.every((r) => {
  const a = lookupQuota(params.quota, r, qCache)
  const b = lookupQuota(params.quota, r)
  return a === b || (a == null && b == null)
})
const cSame = c1Refs.every((r) => lookupC1(params.c1, r, cCache) === lookupC1(params.c1, r))

console.log('══ 查找缓存 ══')
console.log(`  缓存 / 逐次查找结果一致： 定额 ${qSame}   C.1 ${cSame}`)
console.log(`  定额缓存键 ${qCache.size} 个（探了 ${quotaRefs.length} 次，末次与首次同名 → 应复用）`)
console.log(`  C.1 缓存键 ${cCache.size} 个；「借XX」类别的解析值 = ${lookupC1(params.c1, '借' + omC1Benchmarks[3].category)}`)
console.log('')

// ── 大清单性能护栏（防「悄悄退回每行全表扫描」→ 主人又看到红线拦路）──
// 设备库「全选站点」= 8452 行，正是被旧的 3000 行上限挡住的那个正常用法。
// 取 3 次的**最小值**（排除调度抖动）后本机实测：
//   两级缓存都在      ≈ 45~60 ms
//   只剩归一化名缓存  ≈ 330 ms     ← 等价于「摘掉 ref 缓存」
//   两级全摘          ≈ 1040 ms（最坏 3850 ms）
// 阈值 220ms：对现状有约 4 倍余量（不误报），但「摘掉 ref 缓存」会被抓住。
// ⚠️ 这条护栏做过反向实测 —— 第一版阈值 800ms 时摘掉缓存仍能通过，等于摆设，故收紧。
// 这类回归 esbuild / imports / vue / dbsql 四项**全都查不出来**，只能靠实测。
const PERF_MAX_MS = 220
const bigItems: OmItemInput[] = Array.from({ length: 8452 }, (_, i) => {
  const q = omQuotaItems[i % omQuotaItems.length]
  return {
    name: q.name,
    station: omStationTypes[i % omStationTypes.length].name,
    qty: 1 + (i % 5),
    // 2/3 精确命中、1/3 未命中（对应真实设备库 66.8% 的定额覆盖率）
    quota_ref: i % 3 === 0 ? q.name : `${q.name}（含安装附件）`,
  } as OmItemInput
})
let perfMs = Number.POSITIVE_INFINITY
let bigTotal = 0
let bigUnresolved = 0
for (let k = 0; k < 3; k++) {
  const tPerf0 = process.hrtime.bigint()
  const bigRes = calcOm('quota', bigItems, params)
  perfMs = Math.min(perfMs, Number(process.hrtime.bigint() - tPerf0) / 1e6)
  bigTotal = bigRes.total
  bigUnresolved = bigRes.items.filter((x) => !x.resolved).length
}
console.log('══ 大清单性能 ══')
console.log(`  定额法 8452 行 = ${perfMs.toFixed(1)} ms（3 次取最小；阈值 ${PERF_MAX_MS}ms，摘掉 ref 缓存会到 ~330ms）`)
console.log(`  合计 = ${bigTotal.toFixed(2)} 元；未匹配 ${bigUnresolved} 行`)
console.log('')

// ── 单行追溯（借鉴外部设计文档里的「trace 快照 / 追溯抽屉」）────────
// 要守住的核心不变式只有一条：**追溯面板给出的金额，必须等于引擎算出的金额**。
// 追溯不是另写一套算法、也不是事后手写的解释 —— 那样引擎一改，面板就会与金额脱节，
// 比没有追溯更糟（会让人以为「系统自己都说不清」）。
const trC1 = traceOmRow('c1', r1.items[0], params)
const trQuota = traceOmRow('quota', r2.items[0], params)
const trSoft = traceOmRow('quota', soft, params)
const trNoBill = traceOmRow('quota', { ...r2.items[0], billable: false, amount: 0 } as any, params)
// 未匹配行：把类别清空让它必然落空，追溯必须如实说明而不是硬编一个算式
const trMiss = traceOmRow('c1', calcOm('c1', [{ name: '绝不存在的设备XYZ', qty: 1, category_ref: '绝不存在的类别XYZ' } as OmItemInput], params).items[0], params)
const trText = trC1.steps.concat(trQuota.steps, trSoft.steps)
  .map((s) => `${s.label}|${s.detail}|${s.from || ''}`).join(' ')
const trVars = ['month_wage', 'fp_coef', 'wage_ratio', 'formula_raw'].filter((v) => trText.includes(v))
const subNums = (s: string) => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
const subC1 = subNums(trC1.substitution)
const subQ = subNums(trQuota.substitution)
console.log('══ 单行追溯 ══')
console.log(`  C.1  ${trC1.formula}`)
console.log(`  ${trC1.substitution} 元`)
console.log(`  定额法 ${trQuota.formula}`)
console.log(`  ${trQuota.substitution} 元`)
console.log('')

// ══ 导出 Excel ══
// 导出必须与引擎同源，所以这里把工作簿生成后**再读回来**逐项核对（sheet 名 / 明细行数 /
// 合计金额 / 页脚）。只生成不读回的测试等于没测 —— 文件没人打开过，就不知道里面到底有没有数。
const expInfo = {
  projectName: '自检导出样本',
  sourceLabel: '示例清单',
  siteLabel: '全选（示例）',
  operatorName: 'self-test',
  createdAt: new Date('2026-09-15T08:00:00Z'),
  paramVersion: '自检参数快照',
}
const wbBack = XLSX.read(buildOmWorkbook(r1, params, expInfo), { type: 'buffer' })
const aoaOf = (name: string) => XLSX.utils.sheet_to_json(wbBack.Sheets[name], { header: 1 }) as any[][]
const sumAoa = aoaOf('费用汇总')
const itemAoa = aoaOf('设备明细')
const unresAoa = aoaOf('未匹配清单')
const paramAoa = aoaOf('参数与出处')
const rowOf = (aoa: any[][], first: string) => aoa.find((r) => String(r?.[0] ?? '') === first)
const expTotal = Number(rowOf(sumAoa, '费用总额(元)')?.[3])
const expSumRow = itemAoa[itemAoa.length - 3] || [] // 明细表：合计行在「空行 + 页脚」之前
const expItemSum = Number(expSumRow[expSumRow.length - 3] ?? expSumRow[expSumRow.length - 4])
const wbText = [sumAoa, itemAoa, unresAoa, paramAoa].flat(2).map((v) => String(v ?? '')).join('|')
const quotaWb = XLSX.read(buildOmWorkbook(r2, params, expInfo), { type: 'buffer' })
const quotaItemAoa = XLSX.utils.sheet_to_json(quotaWb.Sheets['设备明细'], { header: 1 }) as any[][]

console.log('══ 导出 Excel ══')
console.log(`  工作表：${wbBack.SheetNames.join(' / ')}`)
console.log(`  费用总额 = ${expTotal.toFixed(2)} 元；明细合计 = ${expItemSum.toFixed(2)} 元`)
console.log(`  页脚：${sumAoa[sumAoa.length - 1]?.[0]}`)
console.log('')

// ══ 快照复现（离线可验的部分）══
// 存档把参数与清单塞进 JSONB、取出时再 JSON.parse —— 只要往返有精度损失，
// 「复现」就会永远对不上，而这类偏差在页面上只表现为「差几毛钱」，极难归因。故单独锁住。
const snapParams = JSON.parse(JSON.stringify(params)) as OmParams
const snapItems = JSON.parse(JSON.stringify(items)) as OmItemInput[]
const snapItemsQ = JSON.parse(JSON.stringify(itemsQ)) as OmItemInput[]
const r1Snap = calcOm('c1', snapItems, snapParams)
const r2Snap = calcOm('quota', snapItemsQ, snapParams)
const snapDriftRows = r1.items.filter((x, i) => Math.abs(x.amount - r1Snap.items[i].amount) > 1e-9).length

// 参数差异表：自比应无差异；改一个连乘因子应恰好报 1 处、且总额真的跟着变；
// 删一个 C.1 类别应报「删除」。最后一组是重点 —— 差异表必须指向**真会影响金额**的参数，
// 否则「告诉你哪个参数变了」就成了摆设。
const dSelf = diffParams(params, params)
const changedFactor = params.factors.find((f) => f.group_key === 'c1_workload' && f.calc === 'multiply')!
const paramsF2: OmParams = {
  ...params,
  factors: params.factors.map((f) => (f === changedFactor ? { ...f, value: f.value + 0.1 } : f)),
}
const dOne = diffParams(params, paramsF2)
const dOneTotal = calcOm('c1', items, paramsF2).total
const droppedCat = params.c1.find((c) => c.category === r1.items[0].category_ref)?.category || params.c1[0].category
const dDrop = diffParams(params, { ...params, c1: params.c1.filter((c) => c.category !== droppedCat) })

console.log('══ 快照复现 ══')
console.log(`  JSON 往返后：C.1 ${r1.total.toFixed(2)} → ${r1Snap.total.toFixed(2)} 元（逐行漂移 ${snapDriftRows} 行）`)
console.log(`              定额法 ${r2.total.toFixed(2)} → ${r2Snap.total.toFixed(2)} 元`)
console.log(`  参数自比差异 ${dSelf.total} 处；改一个连乘因子 → ${dOne.total} 处，总额变化 ${(dOneTotal - r1.total).toFixed(2)} 元`)
console.log(`  停用 C.1 类别「${droppedCat}」→ ${dDrop.total} 处（类型 ${dDrop.changes[0]?.type}）`)
console.log('')

// ── 断言：引擎必须与源表口径一致（改错参数/公式会在这里红）──
const indMgmt = r1.indirect.find((l) => l.label === '企业管理费')
const rateC1 = omRateItems.filter((r) => r.engine === 'c1')
const rateQ = omRateItems.filter((r) => r.engine === 'quota')
const softRow = omQuotaItems.find((q) => q.name === 'PLC应用系统')!
const plcFormula = quotaValueOf(softRow as any, quotaVars)

const checks: Array<[string, boolean, string]> = [
  // —— C.1 工作量法 ——
  ['人天单价 = 525.835249 元', Math.abs(params.dailyRate - 525.835249) < 1e-5, params.dailyRate.toFixed(6)],
  ['工作量因子 = 2.16', Math.abs(r1.meta.workloadFactor - 2.16) < 1e-9, String(r1.meta.workloadFactor)],
  ['人员配备系数 = 0.905', Math.abs(r1.meta.staffCoef - 0.905) < 1e-9, String(r1.meta.staffCoef)],
  ['生效价格因子 = 1.0136', Math.abs(r1.meta.priceFactor - 1.0136) < 1e-4, r1.meta.priceFactor.toFixed(6)],
  ['单站修正工作量 = 2554.25 人天', Math.abs(r1b.totalPersonDays - 2554.25) < 0.05, r1b.totalPersonDays.toFixed(2)],
  ['C.1 清单 0 行未匹配', r1.items.every((x) => x.resolved), String(r1.items.filter((x) => !x.resolved).length)],
  ['总调中心价格因子 = 1.5204', Math.abs(1.5 * r1.meta.priceFactor - 1.5204) < 1e-4, (1.5 * r1.meta.priceFactor).toFixed(4)],
  // —— 费率基数（源表《运行维护总费用》F15/F16/F17/F18）——
  ['企业管理费基数 = 直接费', indMgmt?.base === '直接费', String(indMgmt?.base)],
  ['利润基数 = 间接费+直接费', r1.indirect.find((l) => l.label === '利润')?.base === '间接费+直接费',
    String(r1.indirect.find((l) => l.label === '利润')?.base)],
  ['税金基数 = 间接费+直接费', r1.tax?.base === '间接费+直接费', String(r1.tax?.base)],
  ['规费基数 = 人工费', r1.otherDirect.every((l) => l.label.includes('社保') ? l.base === '人工费' : true),
    String(r1.otherDirect.find((l) => l.label.includes('社保'))?.base)],
  // 措施项目费在源表里「列而未用」（D33/D34 零引用）→ 必须不在其他直接费里
  ['措施项目费未参与计算（源表列而未用）', r1.otherDirect.every((l) => !l.key.startsWith('measure:')),
    r1.otherDirect.map((l) => l.key).join(',')],
  // —— 定额单价法 ——
  ['定额税金基数 = 直接费', r2.tax?.base === '直接费', String(r2.tax?.base)],
  ['定额备品备件基数 = 直接费+税金', r2.spare?.base === '直接费+税金', String(r2.spare?.base)],
  ['定额清单未匹配 ≤ 10 行', r2.items.filter((x) => !x.resolved).length <= 10, String(r2.items.filter((x) => !x.resolved).length)],
  // —— 定额类别与推导式（源表 7,851 条 J 列公式反查结论）——
  ['软件类定额只有 2 条', omQuotaItems.filter((q) => q.kind === '软件').length === 2,
    String(omQuotaItems.filter((q) => q.kind === '软件').length)],
  ['站控应用系统类别 = 硬件（源表实测）', omQuotaItems.find((q) => q.name === '站控应用系统')?.kind === '硬件',
    String(omQuotaItems.find((q) => q.name === '站控应用系统')?.kind)],
  ['定额公式现算 ≈ 库值（347.821556）', Math.abs(plcFormula - 6.478835) < 0.01, plcFormula.toFixed(6)],
  ['1200/12*wage_ratio 现算 ≈ 库值', (() => {
    const q = omQuotaItems.find((x) => x.name === '站控应用系统')!
    return Math.abs(quotaValueOf(q as any, quotaVars) - 347.821556) < 0.01
  })(), quotaValueOf(omQuotaItems.find((x) => x.name === '站控应用系统') as any, quotaVars).toFixed(6)],
  // —— 软件条目按功能点计价：源表定兴县管理站 J26 = 8052.40 ——
  ['PLC应用系统 73 点位 = 8052.40 元', Math.abs(soft.amount - 8052.40) < 0.5, soft.amount.toFixed(2)],
  ['未填点位数时按 0 计并给出提示', rSoftNoPt.items[0].amount === 0 && !rSoftNoPt.items[0].resolved,
    String(rSoftNoPt.items[0].amount)],
  // —— 费率表按引擎分组 ——
  ['费率表 c1 组不含定额法税金', !rateC1.some((r) => r.group_key === 'tax' && r.base_note === '直接费'),
    rateC1.filter((r) => r.group_key === 'tax').map((r) => r.base_note).join(',')],
  ['费率表 quota 组含税金/备品备件', rateQ.some((r) => r.group_key === 'tax') && rateQ.some((r) => r.group_key === 'spare'),
    rateQ.map((r) => r.group_key).join(',')],
  // —— 工资锚点分离 ——
  ['两法工资锚点已分离', Number(quotaVars.month_wage) === 11402.75 && Math.abs(params.dailyRate * 21.75 - 11436.916667) < 1e-3,
    `quota=${quotaVars.month_wage} c1=${(params.dailyRate * 21.75).toFixed(6)}`],
  // —— 设备价格库取费映射（测算页「按管理处载入真实台账」）——
  ['设备取费映射规则 = 138 条', omDeviceC1Maps.length === 138, String(omDeviceC1Maps.length)],
  ['精确名规则：双电源进线屏 → 借UPS中值', c1of('双电源进线屏（GCS）') === '借UPS中值', c1of('双电源进线屏（GCS）')],
  ['「UPS配电柜」归借UPS中值（不被 UPS 主机规则抢走）', c1of('UPS配电柜') === '借UPS中值', c1of('UPS配电柜')],
  ['「精密空调隔离开关箱」不判为空调（排除词生效）', c1of('精密空调隔离开关箱（内装63A隔离开关一个，自动空气开关2个）') === '',
    c1of('精密空调隔离开关箱（内装63A隔离开关一个，自动空气开关2个）')],
  ['含温湿度控制器的 PLC 柜不判为环境监控设备', c1of('非冗余PLC控制柜（含柜内温湿度控制器、中间继电器、声光报警装置等）') === '',
    c1of('非冗余PLC控制柜（含柜内温湿度控制器、中间继电器、声光报警装置等）')],
  ['关键词规则命中工业交换机', c1of('工业交换机（不配光模块）') === '交换机', c1of('工业交换机（不配光模块）')],
  ['定额精确匹配 UPS电源(3KVA)', !!q1st && q1st.how === 'exact', q1st ? q1st.how : '(未匹配)'],
  ['定额未匹配返回 null', matchQuotaItem('绝不存在的设备名XYZ-123', omQuotaItems as any) === null, ''],
  ['设备库定额法覆盖率 ≥ 6000 行', devQuotaHit >= 6000, String(devQuotaHit)],
  ['设备库 C.1 法覆盖率 ≥ 1900 行', devC1Hit >= 1900, String(devC1Hit)],
  // —— 站点筛选（测算页「选择站点」弹窗的数据基础）——
  ['站点树已排除各管理处的「全站设备汇总」（总调中心除外）',
    siteTree.every((n) => n.subsites.every((s) => s.name !== '全站设备汇总' || n.station === '总调中心')),
    siteTree.flatMap((n) => n.subsites.filter((s) => s.name === '全站设备汇总').map((s) => n.station + '/' + s.name)).join(',')],
  ['总调中心的汇总站保留（它没有真实子站）', !!zdzx && zdzx.count > 0, String(zdzx?.count)],
  ['站点行数合计 = 8452（剔重后）', allRows === 8452, String(allRows)],
  ['石家庄 = 1535 行 / 32 个子站', sjz?.count === 1535 && sjz?.subsites.length === 32,
    `${sjz?.count} 行 / ${sjz?.subsites.length} 个子站`],
  ['选择解析：精确子站 + 管理处通配',
    sel.length === 2 && sel[0].subsite === '正定管理站' && sel[1].subsite === '*', JSON.stringify(sel)],
  ['「邢台::*」按整处行数计',
    countSelectedRows(sel, siteTree) ===
      (sjz?.subsites.find((s) => s.name === '正定管理站')?.count || 0) + (siteTree.find((n) => n.station === '邢台')?.count || 0),
    String(countSelectedRows(sel, siteTree))],
  ['空选择 = 全选全部站点', countSelectedRows([], siteTree) === allRows, String(countSelectedRows([], siteTree))],
  ['站点 WHERE 生成占位符与参数', selWhere.params.length === 3 && selWhere.sql.includes('OR'), selWhere.sql],
  // —— 定额公式的中文说明（数据维护页「计算说明」列，杜绝英文天书）——
  ['349 条定额全部有中文说明', ftext.every(Boolean), String(ftext.filter(Boolean).length)],
  ['中文说明里不含英文变量名', hasLatin.length === 0, hasLatin.slice(0, 2).join(' / ')],
  ['固定值条目的说明统一', omQuotaItems.filter((q) => !q.formula).every((q) => q.formula_text === '固定值，不随后台参数联动'),
    String(omQuotaItems.filter((q) => !q.formula).length)],
  ['「÷ 12个月」年额折月说明 ≥ 35 种', ftextUniq.filter((t) => t.includes('÷ 12个月')).length >= 35,
    String(ftextUniq.filter((t) => t.includes('÷ 12个月')).length)],
  // —— 查找缓存（大清单性能关键；只许加速、不许改结果）——
  ['定额查找：缓存与逐次结果一致', qSame, String(qSame)],
  ['C.1 查找：缓存与逐次结果一致', cSame, String(cSame)],
  ['重复 ref 走缓存（4 次探测只建 3 个键）', qCache.size === 3, String(qCache.size)],
  ['C.1「借XX」类别可解析且入缓存', cCache.size === 3 && c1Refs.slice(0, 2).every((r) => lookupC1(params.c1, r) != null),
    `${cCache.size} 键 / 借类别=${lookupC1(params.c1, c1Refs[1])}`],
  // —— 大清单性能护栏：8452 行不能退化（这是「全选站点」的真实体量）——
  ['定额法 8452 行 < ' + PERF_MAX_MS + 'ms（查找缓存未退化）', perfMs < PERF_MAX_MS, `${perfMs.toFixed(1)} ms`],
  ['大清单确实算出了金额（非空跑）', bigTotal > 0 && bigUnresolved < 8452, `${bigTotal.toFixed(0)} 元 / 未匹配 ${bigUnresolved}`],
  // —— 单行追溯：最要紧的是「追溯金额 = 引擎金额」，否则就是自相矛盾 ——
  ['C.1 追溯金额 = 引擎金额', trC1.amount === r1.items[0].amount, `${trC1.amount} vs ${r1.items[0].amount}`],
  ['定额法追溯金额 = 引擎金额', trQuota.amount === r2.items[0].amount, `${trQuota.amount} vs ${r2.items[0].amount}`],
  ['软件条目追溯金额 = 引擎金额', trSoft.amount === soft.amount, `${trSoft.amount} vs ${soft.amount}`],
  ['C.1 追溯算式自洽（代回去还原金额）',
    subC1.length === 4 && Math.abs(subC1[0] * subC1[1] * subC1[2] - subC1[3]) < 0.01, trC1.substitution],
  ['定额法追溯算式自洽（代回去还原金额）',
    subQ.length === 5 && Math.abs(subQ[0] * subQ[1] * subQ[2] * subQ[3] - subQ[4]) < 0.01, trQuota.substitution],
  ['C.1 追溯含「单位工作量 / 工作量因子 / 人天单价 / 价格因子」四要素',
    ['② 单位工作量 E', '③ 工作量调整因子 F', '⑤ 人天单价', '⑥ 价格调整因子 I']
      .every((k) => trC1.steps.some((s) => s.label.startsWith(k))),
    trC1.steps.map((s) => s.label).join(',')],
  ['定额法追溯含「定额值 / 年·月换算 / 类别系数」三要素',
    ['② 定额值', '③ 年·月换算系数', '④ 类别系数'].every((k) => trQuota.steps.some((s) => s.label.startsWith(k))),
    trQuota.steps.map((s) => s.label).join(',')],
  ['按功能点条目追溯给出「点位数」步骤', trSoft.steps.some((s) => s.label.includes('点位数')),
    trSoft.steps.map((s) => s.label).join(',')],
  ['追溯文本不泄露内部变量名（说人话）', trVars.length === 0, trVars.join(',')],
  ['追溯对未匹配行如实说明并带提示',
    trMiss.amount === 0 && !trMiss.resolved && !!trMiss.warn && trMiss.steps[1].detail.includes('未匹配'),
    trMiss.steps[1].detail],
  ['不计费行的追溯直接说明不计取费', trNoBill.amount === 0 && trNoBill.steps.length === 1 && trNoBill.steps[0].detail.includes('不计费'),
    String(trNoBill.steps.length)],
  ['追溯带出权威出处（C.1 基准与人工成本基数）',
    trC1.refs.length >= 2 && trC1.refs.some((r) => r.from === 'om_wage_base.source'), String(trC1.refs.length)],
  // —— 导出 Excel（读回文件核对，不是只生成）——
  ['导出含 4 个工作表（费用汇总/设备明细/未匹配清单/参数与出处）',
    wbBack.SheetNames.join('|') === '费用汇总|设备明细|未匹配清单|参数与出处', wbBack.SheetNames.join(',')],
  ['导出「费用总额」= 引擎总额（导出与测算同源）',
    Math.abs(expTotal - r1.total) < 0.01, `${expTotal.toFixed(2)} vs ${r1.total.toFixed(2)}`],
  ['导出明细合计 = 引擎明细之和（按原始精度，未逐行舍入）',
    Math.abs(expItemSum - r1.items.reduce((a, x) => a + x.amount, 0)) < 0.01, expItemSum.toFixed(2)],
  ['导出明细行数 = 清单行数（未丢行）',
    itemAoa.length === r1.items.length + 4, // 表头 + 明细 + 合计 + 空行 + 页脚
    `${itemAoa.length - 4} / ${r1.items.length}`],
  ['导出页脚带导出人 / 时间 / 参数版本',
    String(sumAoa[sumAoa.length - 1]?.[0] || '').includes('self-test') &&
    String(sumAoa[sumAoa.length - 1]?.[0] || '').includes('2026-09-15') &&
    String(sumAoa[sumAoa.length - 1]?.[0] || '').includes('自检参数快照'),
    String(sumAoa[sumAoa.length - 1]?.[0] || '').slice(0, 60)],
  ['导出「参数与出处」带全 5 类参数（基数/因子/费率/C.1基准/定额）',
    ['一、人工成本基数', '二、调整因子', '三、费率项', '四、C.1 单位工作量基准', '五、定额单价库']
      .every((k) => paramAoa.some((r) => String(r?.[0] || '').startsWith(k))),
    paramAoa.filter((r) => /^[一二三四五六]、/.test(String(r?.[0] || ''))).length + ' 节'],
  ['导出定额条目带中文「计算说明」而非变量式',
    paramAoa.some((r) => String(r?.[5] || '').includes('运维单价调整系数')),
    String(paramAoa.find((r) => String(r?.[0] || '') === '站点交换机')?.[5] || '').slice(0, 30)],
  ['导出内容无 NaN / undefined 泄漏',
    !/NaN|undefined|null/.test(wbText), wbText.match(/NaN|undefined|null/)?.[0] || ''],
  ['定额法导出明细含「定额值 / 类别系数 / 点位数」列',
    String(quotaItemAoa[0]?.join(',') || '').includes('定额值') &&
    String(quotaItemAoa[0]?.join(',') || '').includes('类别系数') &&
    String(quotaItemAoa[0]?.join(',') || '').includes('点位数'),
    String(quotaItemAoa[0]?.join(',') || '')],
  // —— 快照复现（存档存 JSONB、取出再算，必须一模一样）——
  ['参数与清单经 JSON 往返后 C.1 总额不变',
    Math.abs(r1Snap.total - r1.total) < 1e-6, `${r1Snap.total.toFixed(6)} vs ${r1.total.toFixed(6)}`],
  ['参数与清单经 JSON 往返后逐行金额零漂移',
    snapDriftRows === 0, `${snapDriftRows} 行`],
  ['参数与清单经 JSON 往返后定额法总额不变',
    Math.abs(r2Snap.total - r2.total) < 1e-6, `${r2Snap.total.toFixed(6)} vs ${r2.total.toFixed(6)}`],
  ['参数自比无差异（差异表不会平白报「改过」）', dSelf.total === 0, String(dSelf.total)],
  ['改动一个连乘因子 → 恰好报 1 处差异且带字段名',
    dOne.total === 1 && dOne.changes[0]?.type === 'changed' && dOne.changes[0]?.field === 'value',
    `${dOne.total} 处 / ${dOne.changes[0]?.field}`],
  ['差异表指向的是真会影响金额的参数（改它总额确实变了）',
    Math.abs(dOneTotal - r1.total) > 1, `差额 ${(dOneTotal - r1.total).toFixed(2)} 元`],
  ['停用一个 C.1 类别 → 报「删除」（停用即不再参与计算）',
    dDrop.total === 1 && dDrop.changes[0]?.type === 'removed', `${dDrop.total} 处 / ${dDrop.changes[0]?.type}`],
]

console.log('══ 断言 ══')
let failed = 0
for (const [name, ok, actual] of checks) {
  if (ok) console.log(`  ✓ ${name}`)
  else {
    failed++
    console.log(`  ✗ ${name} —— 实际 ${actual}`)
  }
}
console.log('')
if (failed) {
  console.log(`✗ 运维测算自检未通过（${failed} 项）`)
  process.exit(1)
}
console.log(`✓ 运维测算自检通过：双引擎与源表口径一致（${checks.length} 项断言）`)
