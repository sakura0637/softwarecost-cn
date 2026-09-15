// 离线验证：用种子参数 + 示例清单跑一遍双引擎，与源表口径对数
import { calcOm, type OmParams, type OmItemInput } from '../server/utils/omCalculator'
import {
  omWageBases, omFactors, omRateItems, omC1Benchmarks, omQuotaItems,
  omStationTypes, omSampleItems,
} from '../server/seed/omData'

const wage = omWageBases.find((w) => w.is_default)!
const params: OmParams = {
  wageBases: omWageBases as any,
  wage: wage as any,
  dailyRate: (wage as any).monthly_wage / (wage as any).work_days,
  factors: omFactors.map((f, i) => ({ id: i + 1, ...f })) as any,
  rates: omRateItems.map((r, i) => ({ id: i + 1, ...r })) as any,
  c1: omC1Benchmarks.map((c, i) => ({ id: i + 1, ...c })) as any,
  quota: omQuotaItems.map((q, i) => ({ id: i + 1, ...q })) as any,
  stations: omStationTypes.map((s, i) => ({ id: i + 1, ...s })) as any,
}

console.log('人天单价 =', params.dailyRate.toFixed(6), '元/人天')
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
console.log('  其他直接费小计 =', r1.otherDirectTotal.toFixed(2))
console.log('  直接费         =', r1.directTotal.toFixed(2))
console.log('  间接费         =', r1.indirectTotal.toFixed(2))
console.log('  税金           =', (r1.tax?.amount || 0).toFixed(2))
console.log('  备品备件       =', (r1.spare?.amount || 0).toFixed(2))
console.log('  合计           =', (r1.total / 10000).toFixed(2), '万元')
console.log('  未匹配行数     =', r1.items.filter((x) => !x.resolved).length)
// 抽查若干行（取计费行 + 有代表性的贵重设备）
const picks = ['200kVA UPS主机（双机并联冗余）', '数据库软件', '48口交换机', '室内网络摄像机']
for (const p of picks) {
  const s = r1.items.find((x) => x.name.includes(p.slice(0, 8)))
  if (s) {
    console.log(`  抽查「${s.name.slice(0, 18)}」 站点=${s.station} 数量=${s.qty} E=${s.usedWorkload}` +
      ` 工作量因子后=${s.correctedWorkload.toFixed(4)} 单价=${s.correctedPrice.toFixed(4)} 时间系数=${s.stationTimeFactor} 金额=${s.amount.toFixed(2)}`)
  }
}
// 单站口径（不放大）
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
const itemsQ: OmItemInput[] = omSampleItems.map((it) => ({
  name: it.name,
  station: it.station,
  qty: it.qty,
  quota_ref: it.name,
  kind: '硬件',
}))
const r2 = calcOm('quota', itemsQ, params)
console.log('══ 定额单价法 ══')
console.log('  明细行       =', itemsQ.length)
console.log('  直接运维费   =', r2.laborCost.toFixed(2))
console.log('  合计         =', (r2.total / 10000).toFixed(2), '万元')
console.log('  未匹配行数   =', r2.items.filter((x) => !x.resolved).length)
const q1 = r2.items.find((x) => x.name.includes('UPS电源(3KVA)'))
console.log('  抽查 UPS(3KVA)：定额=' + q1?.usedQuota + ' 系数=' + q1?.kindCoef + ' 金额=' + q1?.amount?.toFixed(2))
const unmatched = r2.items.filter((x) => !x.resolved).map((x) => x.name)
console.log('  未匹配样例:', unmatched.slice(0, 12))

// ── 断言：引擎必须与源表口径一致（改错参数/公式会在这里红）──
const checks: Array<[string, boolean, string]> = [
  ['人天单价 = 525.835249 元', Math.abs(params.dailyRate - 525.835249) < 1e-5, params.dailyRate.toFixed(6)],
  ['工作量因子 = 2.16', Math.abs(r1.meta.workloadFactor - 2.16) < 1e-9, String(r1.meta.workloadFactor)],
  ['人员配备系数 = 0.905', Math.abs(r1.meta.staffCoef - 0.905) < 1e-9, String(r1.meta.staffCoef)],
  ['生效价格因子 = 1.0136', Math.abs(r1.meta.priceFactor - 1.0136) < 1e-4, r1.meta.priceFactor.toFixed(6)],
  ['单站修正工作量 = 2554.25 人天', Math.abs(r1b.totalPersonDays - 2554.25) < 0.05, r1b.totalPersonDays.toFixed(2)],
  ['C.1 清单 0 行未匹配', r1.items.every((x) => x.resolved), String(r1.items.filter((x) => !x.resolved).length)],
  ['总调中心价格因子 = 1.5204', Math.abs(1.5 * r1.meta.priceFactor - 1.5204) < 1e-4, (1.5 * r1.meta.priceFactor).toFixed(4)],
  ['定额清单未匹配 ≤ 10 行', r2.items.filter((x) => !x.resolved).length <= 10, String(r2.items.filter((x) => !x.resolved).length)],
]

console.log('')
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
console.log('✓ 运维测算自检通过：双引擎与源表口径一致')
