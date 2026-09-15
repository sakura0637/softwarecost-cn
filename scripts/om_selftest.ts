// 离线验证：用种子参数 + 示例清单跑一遍双引擎，与源表口径对数
import { calcOm, quotaValueOf, lookupQuota, lookupC1, type OmParams, type OmItemInput } from '../server/utils/omCalculator'
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
