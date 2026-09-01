// 设备价格库种子 → 范式化三表（devices / stations / station_devices）
//
// 设计要点：
//  1. 独立模块，只接收 pool 参数，**不反向 import db.ts**，避免循环依赖、也避免给 db.ts 顶层加复杂度
//     （历史教训：db.ts 顶层代码一旦抛错，整站接口 500）。
//  2. 单价只在 devices 存一份；station_devices 只存数量；合价由 v_device_prices 视图现算。
//  3. 幂等：重复导入不会重复建设备/站点。对照表按 (子站,设备) 累加数量。
//  4. source='manual'（页面手填）的记录**永不覆盖**，这是「改手动触发导入」后保护手工数据的关键。

import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type DeviceRow = {
  station: string
  subsite?: string | null
  category?: string | null
  subcategory?: string | null
  name: string
  unit?: string | null
  brand_model?: string | null
  qty?: number | null
  unit_price?: number | null
  total_price?: number | null
  remark?: string | null
}

// 各管理处把「子站合计」也作为一行存进了大表，这些行不能计入金额
const SUMMARY_SUBSITE = '全站设备汇总'
// 总调中心没有真实子站，它的「全站设备汇总」就是本站明细，必须保留
const SUMMARY_EXEMPT_STATION = '总调中心'
// subsite 为空（设备直属管理处、不属于任何子站）时的占位子节点
const DIRECT_SUBSITE = '（直属）'

function resolveSeedFile(): string {
  const candidates: string[] = []
  const here = dirname(fileURLToPath(import.meta.url))
  const byMeta = here.replace(/[\\/]server[\\/]utils$/, '')
  if (byMeta && byMeta !== here) candidates.push(join(byMeta, 'server', 'seed'))
  if (process.env.DB_DIR) candidates.push(join(process.env.DB_DIR, '..', 'server', 'seed'))
  candidates.push(join(process.cwd(), 'server', 'seed'))
  for (const d of candidates) {
    const f = join(d, 'device_prices_seed.json')
    if (existsSync(f)) return f
  }
  return join(candidates[candidates.length - 1], 'device_prices_seed.json')
}

export function loadDeviceSeedRows(): DeviceRow[] {
  const f = resolveSeedFile()
  if (!existsSync(f)) return []
  try {
    return JSON.parse(readFileSync(f, 'utf-8'))
  } catch {
    return []
  }
}

// 设备去重键：分类+子分类+名称+品牌型号+单位+单价。
// 注意不含价格以外的身份信息，所以「同名同型号不同单价」会被视为不同设备（历史数据里确有 317 组）。
function deviceKey(r: DeviceRow): string {
  return JSON.stringify([
    r.category ?? '',
    r.subcategory ?? '',
    r.name ?? '',
    r.brand_model ?? '',
    r.unit ?? '',
    r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
  ])
}

export type BuiltTables = {
  stations: Array<{ station: string | null; subsite: string; isSummary: boolean }>
  devices: Array<{
    key: string
    category: string | null
    subcategory: string | null
    name: string
    brand_model: string | null
    unit: string | null
    unit_price: number | null
  }>
  links: Array<{ station: string | null; subsite: string; deviceKey: string; qty: number | null; remark: string | null }>
}

// 纯函数：把扁平大表行构建成三表结构。迁移脚本与导入接口共用同一套口径。
export function buildDeviceTablesFromRows(rows: DeviceRow[]): BuiltTables {
  const subsiteMap = new Map<string, { station: string | null; subsite: string; isSummary: boolean }>()
  const devMap = new Map<string, BuiltTables['devices'][number]>()
  const links: BuiltTables['links'] = []
  // 同一子站同一设备可能出现多行（分批录入）→ 累加数量，备注取第一条
  const linkAgg = new Map<string, { qty: number | null; remark: string | null }>()

  for (const r of rows) {
    const station = (r.station || '').trim()
    const rawSub = (r.subsite || '').trim()
    const subsite = rawSub || DIRECT_SUBSITE
    const isSummary = rawSub === SUMMARY_SUBSITE && station !== SUMMARY_EXEMPT_STATION
    const sk = station + '\u0000' + subsite
    if (!subsiteMap.has(sk)) {
      subsiteMap.set(sk, { station: station || null, subsite, isSummary })
    }

    const dk = deviceKey(r)
    if (!devMap.has(dk)) {
      devMap.set(dk, {
        key: dk,
        category: r.category ?? null,
        subcategory: r.subcategory ?? null,
        name: r.name,
        brand_model: r.brand_model ?? null,
        unit: r.unit ?? null,
        unit_price: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
      })
    }

    const q = r.qty === null || r.qty === undefined ? null : Number(r.qty)
    const lk = sk + '\u0000' + dk
    const prev = linkAgg.get(lk)
    if (prev) {
      prev.qty = (prev.qty ?? 0) + (q ?? 0)
    } else {
      linkAgg.set(lk, { qty: q, remark: r.remark ?? null })
      links.push({ station: station || null, subsite, deviceKey: dk, qty: q, remark: r.remark ?? null })
    }
  }
  // 回写累加后的数量
  for (const l of links) {
    const lk = (l.station ?? '') + '\u0000' + l.subsite + '\u0000' + l.deviceKey
    l.qty = linkAgg.get(lk)?.qty ?? l.qty
  }

  return { stations: Array.from(subsiteMap.values()), devices: Array.from(devMap.values()), links }
}

export type ImportStats = { stations: number; devices: number; links: number; skippedManual: number }

/**
 * 把扁平设备行灌入三张表。
 * - 站点/子站/设备：已存在则复用（幂等，不会重复建）
 * - 对照表：冲突时以台账数量覆盖（导入的是完整快照，覆盖才幂等；累加会导致重复导入时数量翻倍）；
 *   若已有记录是 manual 来源则整条跳过，绝不覆盖手工数据
 */
export async function importSeedToDeviceTables(pool: any, rows?: DeviceRow[]): Promise<ImportStats> {
  const data = rows ?? loadDeviceSeedRows()
  if (!data.length) return { stations: 0, devices: 0, links: 0, skippedManual: 0 }

  const built = buildDeviceTablesFromRows(data)
  const stationId = new Map<string, number>()
  let skippedManual = 0

  // 1) 站点层级（先确保管理处存在，再挂子站）
  for (const s of built.stations) {
    let parentId: number | null = null
    if (s.station) {
      const pr = await pool.query('SELECT id FROM stations WHERE parent_id IS NULL AND name = $1', [s.station])
      if (pr.rows.length) {
        parentId = pr.rows[0].id
      } else {
        const ins = await pool.query(
          `INSERT INTO stations (parent_id, name, level, is_summary, source)
           VALUES (NULL, $1, 1, false, 'seed') RETURNING id`,
          [s.station]
        )
        parentId = ins.rows[0].id
      }
    }
    const key = (s.station ?? '') + '\u0000' + s.subsite
    const ex = await pool.query(
      'SELECT id FROM stations WHERE COALESCE(parent_id, 0) = $1 AND name = $2',
      [parentId ?? 0, s.subsite]
    )
    if (ex.rows.length) {
      stationId.set(key, ex.rows[0].id)
      // 汇总标记以种子为准补正（手动新增的站点不改）
      await pool.query('UPDATE stations SET is_summary = $1 WHERE id = $2 AND source <> $3', [
        s.isSummary,
        ex.rows[0].id,
        'manual',
      ])
    } else {
      const ins = await pool.query(
        `INSERT INTO stations (parent_id, name, level, is_summary, source)
         VALUES ($1, $2, 2, $3, 'seed') RETURNING id`,
        [parentId, s.subsite, s.isSummary]
      )
      stationId.set(key, ins.rows[0].id)
    }
  }

  // 2) 设备主数据（按 lookup 键去重，已存在则复用其 id）
  const deviceId = new Map<string, number>()
  for (const d of built.devices) {
    const ex = await pool.query(
      `SELECT id FROM devices
       WHERE COALESCE(category,'')    = $1
         AND COALESCE(subcategory,'') = $2
         AND name                     = $3
         AND COALESCE(brand_model,'') = $4
         AND COALESCE(unit,'')        = $5
         AND unit_price IS NOT DISTINCT FROM $6
       LIMIT 1`,
      [d.category ?? '', d.subcategory ?? '', d.name, d.brand_model ?? '', d.unit ?? '', d.unit_price]
    )
    if (ex.rows.length) {
      deviceId.set(d.key, ex.rows[0].id)
      continue
    }
    const ins = await pool.query(
      `INSERT INTO devices (category, subcategory, name, brand_model, unit, unit_price, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'seed') RETURNING id`,
      [d.category, d.subcategory, d.name, d.brand_model, d.unit, d.unit_price]
    )
    deviceId.set(d.key, ins.rows[0].id)
  }

  // 3) 站点-设备对照（只存数量；manual 记录不覆盖）
  let links = 0
  for (const l of built.links) {
    const sid = stationId.get((l.station ?? '') + '\u0000' + l.subsite)
    const did = deviceId.get(l.deviceKey)
    if (!sid || !did) continue
    const res = await pool.query(
      `INSERT INTO station_devices (subsite_id, device_id, qty, remark, source)
       VALUES ($1, $2, $3, $4, 'seed')
       ON CONFLICT (subsite_id, device_id)
       DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()
       WHERE station_devices.source <> 'manual'
       RETURNING id`,
      [sid, did, l.qty, l.remark]
    )
    if (res.rows.length) links++
    else skippedManual++
  }

  return { stations: stationId.size, devices: deviceId.size, links, skippedManual }
}
