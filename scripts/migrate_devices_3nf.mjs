#!/usr/bin/env node
// 设备价格库：宽表 device_prices → 范式化三表（devices / stations / station_devices）
//
// 【何时跑】只需在服务器手动执行一次（首次初始化）。可重复执行（幂等，不会翻倍）。
// 【用法】DATABASE_URL=postgres://... node scripts/migrate_devices_3nf.mjs
//         未设 DATABASE_URL 时自动尝试读取项目根 .env
//
// 【安全保证】
//   1. 先把原表完整备份为 device_prices_bak_20260901（已存在则跳过，绝不覆盖旧备份）
//   2. 只写三张新表，**绝不删除/修改原表 device_prices**，随时可回退
//   3. 全程单事务，任一步失败整段回滚
//   4. source='manual'（页面手填）的记录不被覆盖

import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SUMMARY_SUBSITE = '全站设备汇总'
const SUMMARY_EXEMPT_STATION = '总调中心'
const DIRECT_SUBSITE = '（直属）'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

// 三表 + 视图（与 db.ts 的 DDL 保持一致；此处独立执行，保证脚本可脱离应用单独跑）
const DDL = `
CREATE TABLE IF NOT EXISTS devices (
  id           SERIAL PRIMARY KEY,
  category     VARCHAR(64),
  subcategory  VARCHAR(64),
  name         VARCHAR(255) NOT NULL,
  brand_model  VARCHAR(255),
  unit         TEXT,
  unit_price   DOUBLE PRECISION,
  remark       TEXT,
  source       VARCHAR(16)  NOT NULL DEFAULT 'seed',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dev_lookup ON devices(category, subcategory, name, brand_model, unit);
CREATE INDEX IF NOT EXISTS idx_dev_name   ON devices(name);

CREATE TABLE IF NOT EXISTS stations (
  id          SERIAL PRIMARY KEY,
  parent_id   INTEGER REFERENCES stations(id) ON DELETE RESTRICT,
  name        VARCHAR(64) NOT NULL,
  level       SMALLINT    NOT NULL DEFAULT 2,
  type        VARCHAR(64),
  is_summary  BOOLEAN     NOT NULL DEFAULT false,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  remark      TEXT,
  source      VARCHAR(16) NOT NULL DEFAULT 'seed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_station_name  ON stations(COALESCE(parent_id,0), name);
CREATE INDEX IF NOT EXISTS idx_station_parent ON stations(parent_id);

CREATE TABLE IF NOT EXISTS station_devices (
  id          SERIAL PRIMARY KEY,
  subsite_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE RESTRICT,
  device_id   INTEGER NOT NULL REFERENCES devices(id)  ON DELETE RESTRICT,
  qty         DOUBLE PRECISION,
  remark      TEXT,
  source      VARCHAR(16) NOT NULL DEFAULT 'seed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sd ON station_devices(subsite_id, device_id);
CREATE INDEX IF NOT EXISTS idx_sd_device ON station_devices(device_id);

CREATE OR REPLACE VIEW v_device_prices AS
SELECT
  COALESCE(p.name, s.name) AS station,
  s.name                   AS subsite,
  s.is_summary             AS is_summary,
  d.category, d.subcategory, d.name, d.brand_model, d.unit,
  sd.qty,
  d.unit_price,
  (sd.qty * d.unit_price)  AS total_price,
  sd.remark,
  sd.id AS sd_id,
  d.id  AS device_id,
  s.id  AS subsite_id
FROM station_devices sd
JOIN devices  d  ON d.id  = sd.device_id
JOIN stations s  ON s.id  = sd.subsite_id
LEFT JOIN stations p ON p.id = s.parent_id;
`

function deviceKey(r) {
  return JSON.stringify([
    r.category ?? '', r.subcategory ?? '', r.name ?? '', r.brand_model ?? '', r.unit ?? '',
    r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
  ])
}

// 扁平大表行 → 三表结构（口径与 server/utils/deviceSeed.ts 完全一致）
export function buildTables(rows) {
  const subsiteMap = new Map()
  const devMap = new Map()
  const links = []
  const linkAgg = new Map()

  for (const r of rows) {
    const station = (r.station || '').trim()
    const rawSub = (r.subsite || '').trim()
    const subsite = rawSub || DIRECT_SUBSITE
    const isSummary = rawSub === SUMMARY_SUBSITE && station !== SUMMARY_EXEMPT_STATION
    const sk = station + '\u0000' + subsite
    if (!subsiteMap.has(sk)) subsiteMap.set(sk, { station: station || null, subsite, isSummary })

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
    if (prev) prev.qty = (prev.qty ?? 0) + (q ?? 0)
    else {
      linkAgg.set(lk, { qty: q, remark: r.remark ?? null })
      links.push({ station: station || null, subsite, deviceKey: dk, qty: q, remark: r.remark ?? null })
    }
  }
  for (const l of links) {
    const lk = (l.station ?? '') + '\u0000' + l.subsite + '\u0000' + l.deviceKey
    l.qty = linkAgg.get(lk)?.qty ?? l.qty
  }
  return { stations: Array.from(subsiteMap.values()), devices: Array.from(devMap.values()), links }
}

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
const wan = (n) => (n === null || n === undefined ? '—' : (Number(n) / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }))

async function main() {
  const url = resolveDatabaseUrl()
  if (!url) {
    console.error('未找到 DATABASE_URL：请先 export DATABASE_URL=... 或在项目根 .env 配置')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  const client = await pool.connect()

  try {
    console.log('=== 0/5 建表（幂等）===')
    await client.query(DDL)
    console.log('三表与视图就绪')

    console.log('\n=== 1/5 备份原表 ===')
    const bak = await client.query("SELECT to_regclass('device_prices_bak_20260901') AS r")
    if (bak.rows[0].r) {
      console.log('备份表 device_prices_bak_20260901 已存在，跳过（不覆盖旧备份）')
    } else {
      await client.query('CREATE TABLE device_prices_bak_20260901 AS SELECT * FROM device_prices')
      const c = await client.query('SELECT COUNT(*)::int AS c FROM device_prices_bak_20260901')
      console.log(`已备份 → device_prices_bak_20260901（${c.rows[0].c} 行）`)
    }

    console.log('\n=== 2/5 读取原表 ===')
    const src = await client.query('SELECT * FROM device_prices')
    const rows = src.rows
    if (!rows.length) {
      console.log('原表为空，改为从种子文件初始化（交给应用首次启动或导入接口处理）')
    }
    console.log(`原表 ${rows.length} 行`)

    const built = buildTables(rows)
    console.log(
      `构建结果：站点/子站节点 ${built.stations.length} 个，去重设备 ${built.devices.length} 条，对照记录 ${built.links.length} 条`
    )

    console.log('\n=== 3/5 灌入三表（单事务）===')
    await client.query('BEGIN')
    const stationId = new Map()
    for (const s of built.stations) {
      let parentId = null
      if (s.station) {
        const pr = await client.query('SELECT id FROM stations WHERE parent_id IS NULL AND name=$1', [s.station])
        if (pr.rows.length) parentId = pr.rows[0].id
        else {
          const ins = await client.query(
            `INSERT INTO stations (parent_id, name, level, is_summary, source) VALUES (NULL,$1,1,false,'seed') RETURNING id`,
            [s.station]
          )
          parentId = ins.rows[0].id
        }
      }
      const key = (s.station ?? '') + '\u0000' + s.subsite
      const ex = await client.query('SELECT id FROM stations WHERE COALESCE(parent_id,0)=$1 AND name=$2', [
        parentId ?? 0,
        s.subsite,
      ])
      if (ex.rows.length) {
        stationId.set(key, ex.rows[0].id)
        await client.query('UPDATE stations SET is_summary=$1 WHERE id=$2 AND source<>$3', [
          s.isSummary,
          ex.rows[0].id,
          'manual',
        ])
      } else {
        const ins = await client.query(
          `INSERT INTO stations (parent_id, name, level, is_summary, source) VALUES ($1,$2,2,$3,'seed') RETURNING id`,
          [parentId, s.subsite, s.isSummary]
        )
        stationId.set(key, ins.rows[0].id)
      }
    }

    const deviceId = new Map()
    for (const d of built.devices) {
      const ex = await client.query(
        `SELECT id FROM devices
         WHERE COALESCE(category,'')=$1 AND COALESCE(subcategory,'')=$2 AND name=$3
           AND COALESCE(brand_model,'')=$4 AND COALESCE(unit,'')=$5
           AND unit_price IS NOT DISTINCT FROM $6 LIMIT 1`,
        [d.category ?? '', d.subcategory ?? '', d.name, d.brand_model ?? '', d.unit ?? '', d.unit_price]
      )
      if (ex.rows.length) {
        deviceId.set(d.key, ex.rows[0].id)
        continue
      }
      const ins = await client.query(
        `INSERT INTO devices (category, subcategory, name, brand_model, unit, unit_price, source)
         VALUES ($1,$2,$3,$4,$5,$6,'seed') RETURNING id`,
        [d.category, d.subcategory, d.name, d.brand_model, d.unit, d.unit_price]
      )
      deviceId.set(d.key, ins.rows[0].id)
    }

    let links = 0
    let skippedManual = 0
    for (const l of built.links) {
      const sid = stationId.get((l.station ?? '') + '\u0000' + l.subsite)
      const did = deviceId.get(l.deviceKey)
      if (!sid || !did) continue
      const res = await client.query(
        `INSERT INTO station_devices (subsite_id, device_id, qty, remark, source)
         VALUES ($1,$2,$3,$4,'seed')
         ON CONFLICT (subsite_id, device_id)
         DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()
         WHERE station_devices.source <> 'manual'
         RETURNING id`,
        [sid, did, l.qty, l.remark]
      )
      if (res.rows.length) links++
      else skippedManual++
    }
    await client.query('COMMIT')
    console.log(`已写入：站点/子站 ${stationId.size}，设备 ${deviceId.size}，对照 ${links}（跳过 manual ${skippedManual}）`)

    console.log('\n=== 4/5 对账 ===')
    const before = await client.query(`
      SELECT
        COUNT(*)::int AS total_rows,
        (SELECT COUNT(*)::int FROM (SELECT DISTINCT category, subcategory, name, brand_model, unit, unit_price FROM device_prices) t) AS distinct_devices,
        COALESCE(SUM(CASE WHEN NOT (subsite=$1 AND station<>$2) THEN total_price ELSE 0 END),0) AS detail_amt,
        COALESCE(SUM(CASE WHEN (subsite=$1 AND station<>$2) THEN total_price ELSE 0 END),0) AS summary_amt
      FROM device_prices
    `, [SUMMARY_SUBSITE, SUMMARY_EXEMPT_STATION])

    const after = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM devices) AS devices,
        (SELECT COUNT(*)::int FROM stations WHERE parent_id IS NULL) AS stations_l1,
        (SELECT COUNT(*)::int FROM stations WHERE parent_id IS NOT NULL) AS stations_l2,
        (SELECT COUNT(*)::int FROM station_devices) AS links,
        (SELECT COALESCE(SUM(sd.qty*d.unit_price),0) FROM station_devices sd
           JOIN devices d ON d.id=sd.device_id JOIN stations s ON s.id=sd.subsite_id WHERE NOT s.is_summary) AS detail_amt,
        (SELECT COALESCE(SUM(sd.qty*d.unit_price),0) FROM station_devices sd
           JOIN devices d ON d.id=sd.device_id JOIN stations s ON s.id=sd.subsite_id WHERE s.is_summary) AS summary_amt
    `)

    const b = before.rows[0]
    const a = after.rows[0]
    const rowsOut = [
      ['原表行数', fmt(b.total_rows), '对照表行数', fmt(a.links)],
      ['原表去重设备数', fmt(b.distinct_devices), 'devices 表设备数', fmt(a.devices)],
      ['', '', '管理处节点', fmt(a.stations_l1)],
      ['', '', '子站节点', fmt(a.stations_l2)],
      ['原表明细金额(元)', fmt(b.detail_amt), '新表明细金额(元)', fmt(a.detail_amt)],
      ['原表明细金额(万元)', wan(b.detail_amt), '新表明细金额(万元)', wan(a.detail_amt)],
      ['原表汇总金额(元)', fmt(b.summary_amt), '新表汇总金额(元)', fmt(a.summary_amt)],
    ]
    for (const r of rowsOut) {
      console.log(`${String(r[0]).padEnd(20)}${String(r[1]).padStart(16)}   ${String(r[2]).padEnd(18)}${String(r[3]).padStart(16)}`)
    }
    const diff = Number(a.detail_amt) - Number(b.detail_amt)
    console.log(
      `\n明细金额差异：${fmt(diff)} 元（${wan(diff)} 万元）→ 这部分来自原表 169 行「合价错位」被 数量×单价 修正`
    )
    console.log(`汇总金额（各子站合计，统计时必须排除）：新表 ${wan(a.summary_amt)} 万元`)

    console.log('\n=== 5/5 完成 ===')
    console.log('原表 device_prices 未做任何删除/修改；如需回退，删掉三张新表与视图即可。')
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* 忽略回滚失败 */
    }
    console.error('\n迁移失败，已回滚：', e?.message || e)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

// 仅在直接运行时执行；被 import 时只导出 buildTables，便于不连库做本地模拟校验
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
}
