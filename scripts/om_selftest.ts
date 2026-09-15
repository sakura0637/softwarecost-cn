// 离线验证：用种子参数 + 示例清单跑一遍双引擎，与源表口径对数
import { calcOm, quotaValueOf, type OmParams, type OmItemInput } from '../server/utils/omCalculator'
import { matchDevice, matchC1Rule, matchQuotaItem, buildQuotaIndex } from '../server/utils/omDeviceMatcher'
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
const q1 = r2.items.find((x) => x.name.includes('UPS电源(3KVA)'))
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
