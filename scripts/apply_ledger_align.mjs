// 设备台账对齐 v3.4 · 迁移脚本（在服务器上跑，连库）
//
// 干什么：把线上设备价格库改造成**桌面台账 v3.4 的全量形态** ——
//   「以台账为准」= 库里凡台账没有的（行 / 子站）一律删除；台账有的补齐。
//
// 与 apply_device_align.mjs 的区别（方向相反）：
//   apply_device_align 是「对齐到目标态种子」，口径是**库独有全留**（只增不减）；
//   本脚本是**严格以台账为准**，口径是**库独有全删**（台账没有的就删）。
//
// 口径（主人 2026-09-28 明确）：
//   1) 严格以台账为准 —— 台账子站表没有的行 → 删；台账没有的子站 → 删
//   2) 不新增「其它」子站
//   3) 单价不动（台账 ops_price 是运维月费、库 unit_price 是采购价，**两个口径，绝不互灌**）
//   4) source='manual'（页面手填）的行**受保护**，不计入删除
//
// ⚠️ 本脚本会**大批删数据**（实测约 1,865 行关联 + 空子站）。--apply 前自动备份三表。
//
// 用法
//   npm run align:ledger                         # dry-run，只报告不写库
//   npm run align:ledger -- --apply              # 真正执行（**执行前自动备份三表**）
//   npm run align:ledger -- --restore=<备份文件>   # 从自动备份回滚（必须用等号）
//   npm run align:ledger -- --station=保定        # 只处理某个管理处
//   npm run align:ledger -- --keep-manual         # 连 manual 行也按台账删（默认不删）
//
// 连接：本脚本由普通 node 启动（不经 PM2），**.env 不会自动生效** →
//       自己加载 .env，并复刻 db.ts 的连接串口径。

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'
// 复用生产灌入口径（esbuild 打包时把 .ts 一起编译进来）
import { importSeedToDeviceTables } from '../server/utils/deviceSeed'

const APPLY = process.argv.includes('--apply')
const KEEP_MANUAL = process.argv.includes('--keep-manual') // ⚠️ 命名：见下方注释
const HERE = dirname(fileURLToPath(import.meta.url))

function findRoot() {
  const cands = []
  let d = HERE
  for (let i = 0; i < 6; i++) { cands.push(d); d = dirname(d) }
  cands.push(process.cwd())
  for (const c of cands) {
    if (existsSync(join(c, 'server', 'seed', 'device_prices_seed.json'))) return c
  }
  return process.cwd()
}
const ROOT = findRoot()

// 台账目标态（由 scripts/parse_device_ledger.py + 本仓库的 build 步骤生成，随 git 上服务器）
const LEDGER_SEED = join(ROOT, 'server', 'seed', 'ledger_v34_target.json')

if (!existsSync(LEDGER_SEED)) {
  console.error(`✗ 找不到台账目标态 ${LEDGER_SEED}`)
  console.error('  先在本机跑 scripts/parse_device_ledger.py 生成原始解析，再用')
  console.error('  scripts/gen_ledger_target.mjs 转成目标态种子并提交。')
  process.exit(1)
}
const TARGET = JSON.parse(readFileSync(LEDGER_SEED, 'utf8')).rows ?? []

// --restore=<备份文件>：必须用等号（写成空格会取不到值 → 会被当成普通执行把删除再跑一遍）
const RESTORE_ARG = process.argv.find((a) => a === '--restore' || a.startsWith('--restore='))
const RESTORE_FILE = RESTORE_ARG ? RESTORE_ARG.slice('--restore='.length) : ''
if (RESTORE_ARG && !RESTORE_FILE) {
  console.error('✗ --restore 必须写成 --restore=<备份文件>（用等号，不要用空格）')
  console.error('   例：npm run align:ledger -- --restore=_backup/ledger_align_2026-09-28-15-00-00.json')
  process.exit(1)
}

// --station=<名>：只处理某个管理处（用于分批执行）
const STATION_ARG = process.argv.find((a) => a.startsWith('--station='))
const ONLY_STATION = STATION_ARG ? STATION_ARG.slice('--station='.length) : ''

// ── 连接串：与 server/utils/db.ts 同口径 ──
loadEnv({ path: join(ROOT, '.env') })

const connectionString =
  process.env.DATABASE_URL ||
  (() => {
    const host = process.env.DB_HOST || '127.0.0.1'
    const port = process.env.DB_PORT || 5432
    const user = process.env.DB_USER || 'softwarecost'
    const password = encodeURIComponent(process.env.DB_PASSWORD || '')
    const database = process.env.DB_NAME || 'software_cost'
    return `postgres://${user}:${password}@${host}:${port}/${database}`
  })()

const maskedTarget = connectionString.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 8000 })

const BACKUP_DIR = join(ROOT, '_backup')
const BACKUP_TABLES = ['devices', 'stations', 'station_devices']

const log = (...a) => console.log(...a)

async function snapshotTables() {
  const dump = { takenAt: new Date().toISOString(), target: maskedTarget, tables: {} }
  for (const t of BACKUP_TABLES) {
    const r = await pool.query(`SELECT * FROM ${t} ORDER BY id`)
    dump.tables[t] = { columns: r.fields.map((f) => f.name), rows: r.rows }
  }
  mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const file = join(BACKUP_DIR, `ledger_align_${stamp}.json`)
  writeFileSync(file, JSON.stringify(dump))
  const n = BACKUP_TABLES.map((t) => `${t} ${dump.tables[t].rows.length}`).join(' · ')
  return { file, summary: n }
}

function loadBackup(file) {
  if (!existsSync(file)) throw new Error(`备份文件不存在：${file}`)
  let dump
  try {
    dump = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`备份文件不是合法 JSON：${file}（${e.message}）`)
  }
  for (const t of BACKUP_TABLES) {
    if (!dump.tables?.[t]?.columns || !Array.isArray(dump.tables[t].rows)) {
      throw new Error(`备份文件缺少 ${t} 表，拒绝回滚（可能不是本脚本生成的备份）`)
    }
  }
  return dump
}

async function restoreFrom(dump) {
  for (const t of BACKUP_TABLES) log(`   ${t}：${dump.tables[t].rows.length} 行`)

  // ⚠️ 必须用同一条连接跑事务（pool.query 每次可能借出不同连接 → 裸 BEGIN 形同虚设）
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // stations.parent_id 与 station_devices FK 是 RESTRICT → 从叶子往上删
    await client.query('DELETE FROM station_devices')
    for (let guard = 0; guard < 10; guard++) {
      const r = await client.query('DELETE FROM stations WHERE parent_id IS NOT NULL')
      if (!r.rowCount) break
    }
    await client.query('DELETE FROM stations WHERE parent_id IS NULL')
    await client.query('DELETE FROM devices')

    const order = ['devices', 'stations', 'station_devices']
    for (const t of order) {
      const { columns, rows } = dump.tables[t]
      const cols = columns.map((c) => `"${c}"`).join(',')
      const list =
        t === 'stations'
          ? [...rows.filter((r) => r.parent_id == null), ...rows.filter((r) => r.parent_id != null)]
          : rows
      const CHUNK = 200
      for (let i = 0; i < list.length; i += CHUNK) {
        const slice = list.slice(i, i + CHUNK)
        const params = []
        const tuples = slice.map((row) => {
          const base = params.length
          for (const c of columns) params.push(row[c])
          return `(${columns.map((_, j) => `$${base + j + 1}`).join(',')})`
        })
        await client.query(`INSERT INTO ${t} (${cols}) VALUES ${tuples.join(',')}`, params)
      }
      log(`   已写回 ${t}：${list.length} 行`)
    }

    for (const t of BACKUP_TABLES) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  const after = {}
  for (const t of BACKUP_TABLES) {
    after[t] = Number((await pool.query(`SELECT COUNT(*)::int c FROM ${t}`)).rows[0].c)
  }
  log(`回滚完成：${BACKUP_TABLES.map((t) => `${t} ${after[t]}`).join(' · ')}`)
}

// ── 目标态索引：以「(管理处, 子站, 六字段键)」为单位 ──
// 六字段键与 deviceSeed.ts 的 lookup 口径一致：(分类, 子分类, 名称, 品牌型号, 单位, 单价)
// ⚠️ 单价一律取 null 做键 —— 因为**单价不动**，库里的 unit_price 可能与台账不同却不该删行。
//    所以比对只用前五项（分类/子分类/名称/品牌/单位），与本次核对的判据一致。
const norm = (v) => (v == null ? '' : String(v).trim().replace(/（/g, '(').replace(/）/g, ')').replace(/　/g, ''))
const key5 = (station, subsite, cat, sub, name, brand, unit) =>
  [norm(station), norm(subsite), norm(cat), norm(sub), norm(name), norm(brand), norm(unit)].join('\u0000')

function buildTargetIndex(rows) {
  const names = new Set() // station\0subsite\0name —— 用于「名称级」宽松兜底判定
  const exact = new Set() // 七字段
  const sites = new Set() // station\0subsite
  const byNameKey = new Map() // station\0subsite\0name -> Set(七字段键)
  for (const r of rows) {
    const k = key5(r.station, r.subsite, r.category, r.subcategory, r.name, r.brand_model, r.unit)
    exact.add(k)
    const nk = [norm(r.station), norm(r.subsite), norm(r.name)].join('\u0000')
    names.add(nk)
    if (!byNameKey.has(nk)) byNameKey.set(nk, new Set())
    byNameKey.get(nk).add(k)
    sites.add([norm(r.station), norm(r.subsite)].join('\u0000'))
  }
  return { exact, names, sites, byNameKey }
}

/**
 * 判定库里一条关联该不该删。
 * 规则（严格以台账为准）：台账该子站表里**没有这个名称** → 删。
 * ⚠️ 为什么用「名称级」而不是「七字段级」：台账写、库也写同一个设备时，
 *    品牌/单位常有细微写法差（如「套」vs「台」），用七字段判会把**台账已有的设备**误删。
 *    名称级更保守：只要台账该站有这个名字就保留，避免误删；多余的品牌/单价差异留给人工。
 */
function shouldDelete(station, subsite, tgt, { name, category, subcategory, brand_model, unit }) {
  const nk = [norm(station), norm(subsite), norm(name)].join('\u0000')
  return !tgt.names.has(nk)
}

// ─────────────────────────────────────────────────────────────
async function main() {
  log(RESTORE_FILE
    ? '═══ 台账 v3.4 对齐 · 回滚模式 ═══'
    : (APPLY ? '═══ 台账 v3.4 对齐 · 执行模式（会删数据）═══' : '═══ 台账 v3.4 对齐 · DRY-RUN（不写库）═══'))
  log(`目标库：${maskedTarget}`)

  let restoreDump = null
  if (RESTORE_FILE) {
    restoreDump = loadBackup(RESTORE_FILE)
    log(`回滚文件：${RESTORE_FILE}`)
  } else {
    log(`目标态（台账）：${TARGET.length} 行`)
  }
  log('')

  try {
    await pool.query('SELECT 1')
  } catch (e) {
    console.error(`✗ 连不上数据库：${e.message}`)
    console.error(`  目标库：${maskedTarget}`)
    console.error(`  已尝试加载 ${join(ROOT, '.env')}。若库在远端，请在服务器上执行本脚本。`)
    await pool.end().catch(() => {})
    process.exit(1)
  }

  if (RESTORE_FILE) {
    await restoreFrom(restoreDump)
    await pool.end()
    return
  }

  const tgt = buildTargetIndex(TARGET)
  if (ONLY_STATION) log(`限定管理处：${ONLY_STATION}\n`)

  // ── 0) 执行前自动备份 ──
  // 为什么需要：本脚本的动作是**单向删除**（关联行 + 空子站），没有备份回不来。
  let backupRel = null
  if (APPLY) {
    log('── 0) 执行前自动备份 ──')
    const snap = await snapshotTables()
    backupRel = relative(ROOT, snap.file)
    log(`   已备份：${snap.summary}`)
    log(`   备份文件：${backupRel}`)
    log(`   回滚命令：npm run align:ledger -- --restore=${backupRel}\n`)
  }

  // ── 1) 读出库中关联（带站点/设备信息）──
  const mgrRows = (await pool.query('SELECT id, name FROM stations WHERE parent_id IS NULL')).rows
  const mgrById = new Map(mgrRows.map((m) => [String(m.id), m.name]))
  const subRows = (await pool.query('SELECT id, name, parent_id, is_summary, source FROM stations WHERE parent_id IS NOT NULL')).rows
  const subById = new Map(subRows.map((s) => [String(s.id), s]))
  const devRows = (await pool.query('SELECT id, category, subcategory, name, brand_model, unit, unit_price, source FROM devices')).rows
  const devById = new Map(devRows.map((d) => [String(d.id), d]))
  const linkRows = (await pool.query('SELECT id, subsite_id, device_id, qty, source FROM station_devices')).rows

  log(`库现状：设备 ${devRows.length} · 关联 ${linkRows.length} · 子站 ${subRows.length} · 管理处 ${mgrRows.length}`)
  log('')

  // ── 2) 逐类统计待删关联 ──
  const delLinkIds = []
  const delByCause = { A_台账无此子站: 0, B_台账该站无此设备: 0, 保留_manual: 0, 保留_台账已有: 0 }
  const delDetail = new Map() // station/subsite -> count

  for (const l of linkRows) {
    const s = subById.get(String(l.subsite_id))
    const d = devById.get(String(l.device_id))
    if (!s || !d) continue
    const station = mgrById.get(String(s.parent_id)) ?? ''
    if (ONLY_STATION && station !== ONLY_STATION) continue

    // manual 保护：默认不删（--keep-manual 才删）
    if (l.source === 'manual' && KEEP_MANUAL) { delByCause.保留_manual++; continue }

    // 汇总站（全站设备汇总）不在台账里 —— 但它是本系统自己的聚合节点，**必须保留**
    if (s.is_summary) { delByCause.保留_台账已有++; continue }

    const subKey = [norm(station), norm(s.name)].join('\u0000')
    if (!tgt.sites.has(subKey)) {
      delByCause.A_台账无此子站++
      delLinkIds.push(l.id)
      delDetail.set(`${station}/${s.name}`, (delDetail.get(`${station}/${s.name}`) || 0) + 1)
      continue
    }
    if (shouldDelete(station, s.name, tgt, d)) {
      delByCause.B_台账该站无此设备++
      delLinkIds.push(l.id)
      delDetail.set(`${station}/${s.name}`, (delDetail.get(`${station}/${s.name}`) || 0) + 1)
    } else {
      delByCause.保留_台账已有++
    }
  }

  log('── 待删关联归因 ──')
  for (const [k, v] of Object.entries(delByCause)) log(`   ${k.padEnd(22)} ${v}`)
  log(`   合计待删 ${delLinkIds.length} 行`)
  log('')
  log('── 待删最多的子站（前 20）──')
  for (const [k, v] of [...delDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    log(`   ${k.padEnd(30)} ${v}`)
  }
  log('')

  // 删完后会变空的子站
  const linkCountBySub = new Map()
  for (const l of linkRows) {
    if (!delLinkIds.includes(l.id)) continue
    linkCountBySub.set(String(l.subsite_id), (linkCountBySub.get(String(l.subsite_id)) || 0) + 1)
  }
  const orphans = []
  for (const s of subRows) {
    if (s.is_summary) continue
    const total = linkRows.filter((l) => String(l.subsite_id) === String(s.id)).length
    const killing = linkCountBySub.get(String(s.id)) || 0
    if (total > 0 && total === killing) {
      const station = mgrById.get(String(s.parent_id)) ?? ''
      if (ONLY_STATION && station !== ONLY_STATION) continue
      orphans.push(`${station}/${s.name}(${total})`)
    }
  }
  log(`── 删完后会变空的子站（将被删除）：${orphans.length} 个 ──`)
  for (const o of orphans) log(`   ${o}`)
  log('')

  // ── 3) 台账有、库没有的（补齐）──
  // 本次核对已证「按管理处 0 缺失」；这里仍算一遍，防未来台账更新后漏补。
  const libNameKeys = new Set()
  for (const l of linkRows) {
    const s = subById.get(String(l.subsite_id))
    const d = devById.get(String(l.device_id))
    if (!s || !d) continue
    const station = mgrById.get(String(s.parent_id)) ?? ''
    libNameKeys.add([norm(station), norm(s.name), norm(d.name)].join('\u0000'))
  }
  const missing = TARGET.filter((r) => !libNameKeys.has([norm(r.station), norm(r.subsite), norm(r.name)].join('\u0000')))
  log(`── 台账有、库没有（待补录）：${missing.length} 行 ──`)
  for (const r of missing.slice(0, 15)) log(`   ${r.station}/${r.subsite} · ${r.name}`)
  if (missing.length > 15) log(`   …（共 ${missing.length} 行）`)
  log('')

  // ── 4) 执行 ──
  if (!APPLY) {
    log('这是 DRY-RUN，未改动任何数据。确认无误后执行：')
    log('   npm run align:ledger -- --apply')
    log('（--apply 会先把三张表自动备份到 _backup/，无需手工 pg_dump）')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 4a) 补录台账有、库没有的
    if (missing.length) {
      log(`── 补录 ${missing.length} 行（台账有、库没有）──`)
      await client.query('COMMIT')
      const st = await importSeedToDeviceTables(pool, missing)
      log(`   补录：站点 ${st.stations} · 设备 ${st.devices} · 关联 ${st.links} · 跳过 manual ${st.skippedManual}`)
      await client.query('BEGIN')
    }

    // 4b) 删除待删关联（分批，避免一次 16000 参数）
    log(`── 删除关联 ${delLinkIds.length} 行 ──`)
    const CHUNK = 500
    for (let i = 0; i < delLinkIds.length; i += CHUNK) {
      const slice = delLinkIds.slice(i, i + CHUNK)
      await client.query(`DELETE FROM station_devices WHERE id = ANY($1::int[])`, [slice])
    }
    log(`   已删 ${delLinkIds.length} 行`)

    // 4c) 删除变空的子站（从叶子往上；都是 level 2，无子级）
    log(`── 删除空子站 ${orphans.length} 个 ──`)
    for (const o of orphans) {
      const name = o.replace(/\(\d+\)$/, '').split('/').slice(1).join('/')
      const station = o.split('/')[0]
      const pid = mgrRows.find((m) => m.name === station)?.id
      if (!pid) continue
      await client.query(
        `DELETE FROM stations WHERE parent_id=$1 AND name=$2
           AND NOT EXISTS (SELECT 1 FROM station_devices sd WHERE sd.subsite_id = stations.id)`,
        [pid, name]
      )
    }

    // 4d) 清理无引用的设备主数据（关联已全删的设备行）
    log('── 清理孤儿设备主数据 ──')
    const orphanDev = await client.query(
      `DELETE FROM devices d
        WHERE d.source <> 'manual'
          AND NOT EXISTS (SELECT 1 FROM station_devices sd WHERE sd.device_id = d.id)`
    )
    log(`   已删设备主数据 ${orphanDev.rowCount} 行`)

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  // ── 5) 执行后复核 ──
  const after = {
    devices: Number((await pool.query('SELECT COUNT(*)::int c FROM devices')).rows[0].c),
    links: Number((await pool.query('SELECT COUNT(*)::int c FROM station_devices')).rows[0].c),
    stations: Number((await pool.query('SELECT COUNT(*)::int c FROM stations')).rows[0].c),
  }
  log(`\n执行后：设备 ${after.devices} · 关联 ${after.links} · 站点 ${after.stations}`)
  if (backupRel) log(`\n如需回滚：npm run align:ledger -- --restore=${backupRel}`)
  await pool.end()
}

main().catch(async (e) => {
  console.error('✗ 执行失败：', e.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
