// 设备台账对齐 · 迁移脚本（在服务器上跑，连库）
//
// 干什么：把线上设备价格库改造成 gen_device_align_seed.mjs 算出的「目标态」。
//   1) 站点改名（去脏数据）+ 合并宿主改名（核心节点）
//   2) 站点重挂（廊坊的霸州/胜芳 → 廊涿）
//   3) 分类归并 + 子分类串位修正（devices 表）
//   4) 灌入目标态种子（补设备、订正数量、新增台账独有）
//   5) 合并收尾：源子站的行搬进宿主 → 删空源站
//
// 幂等：五步都是「已是目标态则无变化」的写法，重复执行安全。
// 保护：station_devices.source='manual' 的行永不被种子覆盖（复用
//       server/utils/deviceSeed.ts 的既有口径）。
//
// 用法
//   npm run align:devices                        # dry-run，只报告不写库
//   npm run align:devices -- --apply             # 真正执行（**执行前自动备份三表**）
//   npm run align:devices -- --restore=<备份文件>  # 从自动备份回滚
//
// 备份：--apply 时会先把 devices / stations / station_devices 三张表整表快照到
//       _backup/device_align_<时间戳>.json，所以不必再手工敲 pg_dump。
//       本脚本只改这三张表，因此只备这三张表就够了（视图不用备，定义在代码里）。
//
// 连接：本脚本由普通 node 启动（不经 PM2），**.env 不会自动生效** →
//       这里自己按 ecosystem.config.cjs 的做法加载 .env，并复刻 db.ts 的连接串口径
//       （DATABASE_URL 优先，否则用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 拼）。

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'
import {
  SITE_MERGE, SITE_RENAME, SITE_REPARENT,
  canonicalCat, CAT_MAP,
} from './device_align_rules.mjs'
// 复用生产灌入口径（esbuild 打包时把 .ts 一起编译进来）
import { importSeedToDeviceTables } from '../server/utils/deviceSeed'

const APPLY = process.argv.includes('--apply')
const HERE = dirname(fileURLToPath(import.meta.url))

// ⚠️ 脚本经 esbuild 打包后落在 node_modules/.cache/，import.meta.url 不再指向 scripts/，
// 所以根目录必须逐级上溯探测（项目里已有的约定：别依赖 import.meta.url 或 cwd 的单一路径）。
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
// 目标态 = 已对齐的种子文件（由 scripts/gen_device_align_seed.mjs 生成，随 git 一起上服务器）
const SEED_TARGET = join(ROOT, 'server', 'seed', 'device_prices_seed.json')

if (!existsSync(SEED_TARGET)) {
  console.error(`✗ 找不到目标态种子 ${SEED_TARGET}`)
  process.exit(1)
}
const TARGET = JSON.parse(readFileSync(SEED_TARGET, 'utf8'))

// --restore=<备份文件>：从自动备份回滚。
// ⚠️ 加个护栏：写成 `--restore 文件`（空格而非等号）会取不到值，若不拦住，
//    脚本会当成「普通执行」把对齐再跑一遍 —— 那正是最不该发生的误操作。
const RESTORE_ARG = process.argv.find((a) => a === '--restore' || a.startsWith('--restore='))
const RESTORE_FILE = RESTORE_ARG ? RESTORE_ARG.slice('--restore='.length) : ''
if (RESTORE_ARG && !RESTORE_FILE) {
  console.error('✗ --restore 必须写成 --restore=<备份文件>（用等号，不要用空格）')
  console.error('   例：npm run align:devices -- --restore=_backup/device_align_2026-09-23-10-00-00.json')
  process.exit(1)
}

// ── 连接串：与 server/utils/db.ts 同口径 ──
// 先加载 .env（PM2 在 ecosystem.config.cjs 里做同样的事；本脚本是普通 node，得自己来）
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

// 打印时隐去密码
const maskedTarget = connectionString.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')

const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 8000 })

const BACKUP_DIR = join(ROOT, '_backup')
// 本脚本只改这三张表，故只需备份这三张（视图不落地，定义在 db.ts 里）
const BACKUP_TABLES = ['devices', 'stations', 'station_devices']

/** 整表快照到 _backup/device_align_<时间戳>.json（含主键，便于原样回滚） */
async function snapshotTables() {
  const dump = { takenAt: new Date().toISOString(), target: maskedTarget, tables: {} }
  for (const t of BACKUP_TABLES) {
    const r = await pool.query(`SELECT * FROM ${t} ORDER BY id`)
    dump.tables[t] = { columns: r.fields.map((f) => f.name), rows: r.rows }
  }
  mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const file = join(BACKUP_DIR, `device_align_${stamp}.json`)
  writeFileSync(file, JSON.stringify(dump))
  const n = BACKUP_TABLES.map((t) => `${t} ${dump.tables[t].rows.length}`).join(' · ')
  return { file, summary: n }
}

/** 读入并校验备份文件（纯本地操作，不连库 —— 参数写错时立刻报错，不必等连上库） */
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

/** 从快照原样回滚（清空三表后按主键重新插入） */
async function restoreFrom(dump) {
  log(`备份时间：${dump.takenAt}`)
  for (const t of BACKUP_TABLES) log(`   ${t}：${dump.tables[t].rows.length} 行`)

  // ⚠️ 必须用**同一条连接**跑事务：pool.query 每次可能借出不同连接，
  //    那样 BEGIN 形同虚设，每条语句各自自动提交 —— 中途失败会留下删了一半的表。
  //    （server/utils/db.ts 的 transaction() 也是靠 pool.connect() 拿单连接解决的）
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ⚠️ stations.parent_id 与 station_devices 的外键都是 RESTRICT（非 CASCADE），
    //    所以必须「从叶子往上删」：先删关联行，再删子站，最后删管理处。
    //    直接一句 DELETE FROM stations 会被 RESTRICT 挡住。
    await client.query('DELETE FROM station_devices')
    for (let guard = 0; guard < 10; guard++) {
      const r = await client.query('DELETE FROM stations WHERE parent_id IS NOT NULL')
      if (!r.rowCount) break
    }
    await client.query('DELETE FROM stations WHERE parent_id IS NULL')
    await client.query('DELETE FROM devices')

    // 插入顺序：devices → stations（先管理处后子站）→ station_devices
    const order = ['devices', 'stations', 'station_devices']
    for (const t of order) {
      const { columns, rows } = dump.tables[t]
      const cols = columns.map((c) => `"${c}"`).join(',')
      const list =
        t === 'stations'
          ? [...rows.filter((r) => r.parent_id == null), ...rows.filter((r) => r.parent_id != null)]
          : rows
      // 分批多值 INSERT：逐行单条插入在 1.6 万行时往返太多次
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

    // 序列归位：显式带主键插入不会推进 SERIAL，不归位则后续 INSERT 撞主键
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

const log = (...a) => console.log(...a)
const stat = { renamed: 0, mergedHost: 0, reparented: 0, catRows: 0, catSkew: 0, movedRows: 0, droppedStations: 0 }

async function mgrId(name) {
  const r = await pool.query('SELECT id FROM stations WHERE parent_id IS NULL AND name = $1', [name])
  return r.rows[0]?.id ?? null
}
async function subId(parentId, name) {
  const r = await pool.query('SELECT id FROM stations WHERE parent_id = $1 AND name = $2', [parentId, name])
  return r.rows[0]?.id ?? null
}
async function q(sql, params) {
  if (APPLY) return pool.query(sql, params)
  return { rows: [], rowCount: 0 }
}

// ─────────────────────────────────────────────────────────────
async function main() {
  log(RESTORE_FILE
    ? '═══ 设备台账对齐 · 回滚模式 ═══'
    : (APPLY ? '═══ 设备台账对齐 · 执行模式 ═══' : '═══ 设备台账对齐 · DRY-RUN（不写库）═══'))
  log(`目标库：${maskedTarget}`)
  // 回滚模式：先做本地校验（备份文件存在 / 是合法 JSON / 三表齐全），再连库
  let restoreDump = null
  if (RESTORE_FILE) {
    restoreDump = loadBackup(RESTORE_FILE)
    log(`回滚文件：${RESTORE_FILE}`)
  } else {
    log(`目标态种子：${TARGET.length} 行`)
  }
  log('')

  // 连接预检：本机没装 PG 时给出明确指引，别只抛一堆 ECONNREFUSED
  try {
    await pool.query('SELECT 1')
  } catch (e) {
    console.error(`✗ 连不上数据库：${e.message}`)
    console.error(`  目标库：${maskedTarget}`)
    console.error(`  已尝试加载 ${join(ROOT, '.env')}（不存在则沿用默认本地连接串）。`)
    console.error('  若库在远端，请在服务器上执行本脚本。')
    await pool.end().catch(() => {})
    process.exit(1)
  }

  // 回滚模式：只回滚，不跑对齐
  if (RESTORE_FILE) {
    await restoreFrom(restoreDump)
    await pool.end()
    return
  }

  // ── 0) 执行前自动备份（只备本脚本会改的三张表）──
  // 为什么需要：后面的动作是**单向**的 —— 站点改名/合并、分类改写共 2,400 行，
  // 且第 6 步会删掉合并后的源子站。种子灌入本身幂等可重跑，但被删的站、
  // 被覆盖的旧站名/旧分类回不来，只有备份能救。
  let backupRel = null
  if (APPLY) {
    log('── 0) 执行前自动备份 ──')
    const snap = await snapshotTables()
    backupRel = relative(ROOT, snap.file)
    log(`   已备份：${snap.summary}`)
    log(`   备份文件：${backupRel}`)
    log(`   回滚命令：npm run align:devices -- --restore=${backupRel}\n`)
  }

  // 前置自检：库里有几个管理处
  const mgrs = (await pool.query('SELECT id, name FROM stations WHERE parent_id IS NULL ORDER BY name')).rows
  log(`库中管理处 ${mgrs.length} 个：${mgrs.map((m) => m.name).join(' / ')}`)
  const missing = [...new Set([
    ...SITE_MERGE.map((g) => g.station),
    ...SITE_RENAME.map((r) => r.station),
    ...SITE_REPARENT.flatMap((r) => [r.fromStation, r.toStation]),
  ])].filter((n) => !mgrs.some((m) => m.name === n))
  if (missing.length) log(`⚠️ 库中缺少管理处：${missing.join(' / ')}（相关动作会跳过）`)

  // ── 1) 合并宿主改名 ──
  log('\n── 1) 核心节点（合并宿主改名）──')
  for (const g of SITE_MERGE) {
    const pid = await mgrId(g.station)
    if (!pid) { log(`   ⚠ ${g.station} 不存在，跳过`); continue }
    const sid = await subId(pid, g.host)
    if (!sid) { log(`   ⚠ ${g.station}/${g.host} 不存在（可能已改过名），跳过`); continue }
    const dup = await subId(pid, g.to)
    if (dup) { log(`   ⚠ ${g.station}/${g.to} 已存在，跳过改名（避免撞唯一键）`); continue }
    await q('UPDATE stations SET name=$1 WHERE id=$2', [g.to, sid])
    stat.mergedHost++
    log(`   ${g.station}: ${g.host} → ${g.to}`)
  }

  // ── 2) 站点改名 ──
  log('\n── 2) 站点改名（去脏数据 / 换台账写法）──')
  for (const r of SITE_RENAME) {
    const pid = await mgrId(r.station)
    if (!pid) continue
    const sid = await subId(pid, r.from)
    if (!sid) { continue }                       // 已改过 → 幂等跳过
    if (await subId(pid, r.to)) { log(`   ⚠ ${r.station}/${r.to} 已存在，跳过 ${r.from}`); continue }
    await q('UPDATE stations SET name=$1 WHERE id=$2', [r.to, sid])
    stat.renamed++
    log(`   ${r.station}: ${r.from} → ${r.to}`)
  }
  log(`   小计改名 ${stat.renamed} 个`)

  // ── 3) 站点重挂 ──
  log('\n── 3) 站点重挂（换管理处）──')
  for (const r of SITE_REPARENT) {
    const fp = await mgrId(r.fromStation)
    const tp = await mgrId(r.toStation)
    if (!fp || !tp) { log(`   ⚠ ${r.fromStation} 或 ${r.toStation} 不存在，跳过`); continue }
    const sid = await subId(fp, r.fromSubsite)
    if (!sid) { continue }
    if (await subId(tp, r.toSubsite)) { log(`   ⚠ ${r.toStation}/${r.toSubsite} 已存在，跳过`); continue }
    await q('UPDATE stations SET parent_id=$1, name=$2 WHERE id=$3', [tp, r.toSubsite, sid])
    stat.reparented++
    log(`   ${r.fromStation}/${r.fromSubsite} → ${r.toStation}/${r.toSubsite}`)
  }
  log(`   小计重挂 ${stat.reparented} 个`)

  // ── 4) 分类归并 + 子分类串位修正 ──
  log('\n── 4) 分类归并 / 子分类串位修正 ──')
  const devs = (await pool.query('SELECT id, category, subcategory FROM devices')).rows
  const catPlan = new Map()          // '旧cat\u0000旧sub' -> [新cat, 新sub]
  const catTally = new Map()
  for (const d of devs) {
    const [nc, ns] = canonicalCat(d.category, d.subcategory, CAT_MAP)
    if ((nc || '') === (d.category || '') && (ns || '') === (d.subcategory || '')) continue
    if (String(d.subcategory || '').match(/^[（(].+[）)].+/)) stat.catSkew++
    const key = `${d.category ?? ''}\u0000${d.subcategory ?? ''}`
    if (!catPlan.has(key)) catPlan.set(key, [nc, ns])
    const label = `${d.category || '(空)'} / ${d.subcategory || '(空)'} → ${nc || '(空)'} / ${ns || '(空)'}`
    catTally.set(label, (catTally.get(label) || 0) + 1)
  }
  for (const [label, n] of [...catTally.entries()].sort((a, b) => b[1] - a[1])) {
    log(`   ${label.padEnd(56)} ×${n}`)
  }
  log(`   小计需改 ${[...catTally.values()].reduce((a, b) => a + b, 0)} 个设备行（其中子分类串位 ${stat.catSkew}）`)
  for (const [key, [nc, ns]] of catPlan) {
    const [oc, os] = key.split('\u0000')
    await q(
      `UPDATE devices SET category=$1, subcategory=$2, updated_at=now()
        WHERE COALESCE(category,'')=$3 AND COALESCE(subcategory,'')=$4`,
      [nc, ns, oc, os]
    )
    stat.catRows++
  }

  // ── 5) 灌入目标态种子 ──
  log('\n── 5) 灌入目标态种子 ──')
  if (APPLY) {
    const s = await importSeedToDeviceTables(pool, TARGET)
    log(`   站点 ${s.stations} · 设备 ${s.devices} · 关联写入 ${s.links} · 跳过 manual ${s.skippedManual}`)
  } else {
    // dry-run：本地算一遍会新增多少设备/关联（不写库）
    const before = {
      devices: Number((await pool.query('SELECT COUNT(*)::int c FROM devices')).rows[0].c),
      links: Number((await pool.query('SELECT COUNT(*)::int c FROM station_devices')).rows[0].c),
      stations: Number((await pool.query('SELECT COUNT(*)::int c FROM stations')).rows[0].c),
    }
    const uniq = new Set(TARGET.map((r) => JSON.stringify([
      r.category ?? '', r.subcategory ?? '', r.name ?? '', r.brand_model ?? '', r.unit ?? '',
      r.unit_price == null ? null : Number(r.unit_price)])))
    const uniqSite = new Set(TARGET.map((r) => (r.station || '') + '\u0000' + (r.subsite || '（直属）')))
    log(`   目标态：设备主数据 ${uniq.size} 种 · 站点-设备关联 ${TARGET.length} 条 · 子站 ${uniqSite.size} 个`)
    log(`   库现状：设备 ${before.devices} 行 · 关联 ${before.links} 行 · 站点 ${before.stations} 行`)
    log('   （执行时会按 (分类,子分类,名称,品牌,单位,单价) 复用已有设备，缺失的才新建）')
  }

  // ── 6) 合并收尾：搬行 + 删空源站 ──
  log('\n── 6) 合并收尾（源子站 → 宿主）──')
  for (const g of SITE_MERGE) {
    if (!g.sources.length) continue
    const pid = await mgrId(g.station)
    if (!pid) continue
    const hostId = await subId(pid, g.to)
    if (!hostId) { log(`   ⚠ ${g.station}/${g.to} 不存在，跳过合并`); continue }
    for (const src of g.sources) {
      const srcId = await subId(pid, src)
      if (!srcId) continue
      const n = Number((await pool.query('SELECT COUNT(*)::int c FROM station_devices WHERE subsite_id=$1', [srcId])).rows[0].c)
      const conflicts = Number((await pool.query(
        `SELECT COUNT(*)::int c FROM station_devices sd
          WHERE sd.subsite_id=$1 AND EXISTS (SELECT 1 FROM station_devices t WHERE t.subsite_id=$2 AND t.device_id=sd.device_id)`,
        [srcId, hostId]
      )).rows[0].c)
      log(`   ${g.station}/${src}：${n} 行 → 宿主（其中 ${conflicts} 行宿主已有，直接丢弃；其余 ${n - conflicts} 行搬过去）`)
      if (APPLY) {
        await pool.query(
          `UPDATE station_devices sd SET subsite_id=$1, updated_at=now()
            WHERE sd.subsite_id=$2
              AND NOT EXISTS (SELECT 1 FROM station_devices t WHERE t.subsite_id=$1 AND t.device_id=sd.device_id)`,
          [hostId, srcId]
        )
        await pool.query('DELETE FROM station_devices WHERE subsite_id=$1', [srcId])
        await pool.query('DELETE FROM stations WHERE id=$1', [srcId])
      }
      stat.movedRows += n - conflicts
      stat.droppedStations++
    }
  }

  // ── 汇总 ──
  log('\n═══ 汇总 ═══')
  log(`核心节点改名 ${stat.mergedHost} · 站点改名 ${stat.renamed} · 重挂 ${stat.reparented}`)
  log(`设备分类改写 ${[...catTally.values()].reduce((a, b) => a + b, 0)} 行 · 搬行 ${stat.movedRows} · 删空源站 ${stat.droppedStations}`)
  if (APPLY) {
    const after = {
      devices: Number((await pool.query('SELECT COUNT(*)::int c FROM devices')).rows[0].c),
      links: Number((await pool.query('SELECT COUNT(*)::int c FROM station_devices')).rows[0].c),
      stations: Number((await pool.query('SELECT COUNT(*)::int c FROM stations')).rows[0].c),
    }
    log(`\n执行后：设备 ${after.devices} 行 · 关联 ${after.links} 行 · 站点 ${after.stations} 行`)
    if (backupRel) {
      log(`\n如需回滚：npm run align:devices -- --restore=${backupRel}`)
      log('（回滚会清空并还原三张表到执行前状态）')
    }
  } else {
    log('\n这是 DRY-RUN，未改动任何数据。确认无误后执行：')
    log('   npm run align:devices -- --apply')
    log('（--apply 会先把三张表自动备份到 _backup/，无需手工 pg_dump）')
  }
  await pool.end()
}

main().catch(async (e) => {
  console.error('✗ 执行失败：', e.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
