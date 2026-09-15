import { omSampleItems, omStationTypes } from '../../seed/omData'

// 示例设备清单：源表《C1取费对照表（三张新表）.xlsx》全量 171 行。
// 用途：测算页「载入示例」按钮，一键验证 C.1 引擎是否与源表口径一致。
// 数量列是「单站」用量，按站点类型数量放大后可得到全量口径。
export default defineEventHandler(() => {
  // 源表站点名 → 站点类型：先按显示名匹配，再按源测算书工作表名匹配
  // （示例里写的是「管理处」，站点类型显示名是「管理处监控中心」，工作表名才是「管理处」）
  const stationOf = (name: string) =>
    omStationTypes.find((s) => s.name === name || s.sheet_name === name)

  return {
    source: '《C1取费对照表（三张新表）.xlsx》三表设备归属与取费',
    items: omSampleItems.map((it, i) => {
      const st = stationOf(it.station)
      return {
        seq: i + 1,
        station: st?.name || it.station,
        station_code: st?.code || '',
        station_qty: st?.qty ?? 1,
        sheet_no: it.sheet_no,
        category: it.category,
        no: it.seq,
        name: it.name,
        unit: it.unit,
        qty: it.qty,
        category_ref: it.category_ref,
        workload: it.workload,
        billable: it.billable,
        note: it.note,
      }
    }),
  }
})
