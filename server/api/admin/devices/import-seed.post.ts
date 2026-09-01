import { createError } from 'h3'
import db, { pool } from '../../../utils/db'
import { requirePerm } from '../../../utils/auth'
import { importSeedToDeviceTables, loadDeviceSeedRows } from '../../../utils/deviceSeed'

// 「手动触发导入」入口：把 server/seed/device_prices_seed.json 增量灌入范式化三表。
// 幂等：重复导入不会重复建设备/站点，数量按台账快照覆盖（不会翻倍）。
// 保护：source='manual'（页面手填）的记录一律不覆盖。
export default defineEventHandler(async (event) => {
  await requirePerm(event, 'devices:edit')

  // bootstrap 是懒执行的，直接用 pool 不会建表，先触发一次确保三表存在
  await db.prepare('SELECT 1').get()

  const rows = loadDeviceSeedRows()
  if (!rows.length) {
    throw createError({ statusCode: 400, statusMessage: '未找到或无法解析种子文件 device_prices_seed.json' })
  }

  const stats = await importSeedToDeviceTables(pool, rows)
  return {
    ok: true,
    source_rows: rows.length,
    stations: stats.stations,
    devices: stats.devices,
    links: stats.links,
    skipped_manual: stats.skippedManual,
  }
})
