// 汇总站重算 · 重算脚本（在服务器上跑，连库）
//
// 干什么：把每个管理处的「全站设备汇总」从「写死的一行」改成「真正汇总本处其它子站所有设备」。
//   1) 读该处的全部**明细子站**设备行（排除汇总站自己）
//   2) 按「同款累加」（分类+子分类+名称+品牌型号+单位+单价 全同）合并
//   3) 把合并结果写回汇总站：新出现的插入、数量变了的更新、明细里已没有的删除
//
// 与「台账对齐」的分工：
//   - align:devices 改的是**明细**（站点归并 / 分类归一 / 数量订正）
//   - recalc:summary 只改**汇总站**一行的 qty，是 align 的收尾动作
//   两者都幂等，顺序无所谓，但明细动过之后必须再跑一次 recalc 才能让汇总跟上。
//
// 幂等：目标是「汇总站 == 明细累加」，重复执行第二次必然 0 变化。
//
// 保护：
//   - 汇总站里 source='manual' 的行**不覆盖也不删除**（页面手填的数据优先）
//   - 单价一律不动（单价在 devices 主数据里只有一份，汇总站只是引用同一个 device_id）
//   - 廊涿 / 廊坊 / 总调中心的「全站设备汇总」是独立清单而非冗余合计，**完全跳过**
//
// 用法
//   npm run recalc:summary                      # dry-run，只报告不写库
//   npm run recalc:summary -- --apply           # 真正执行（**执行前自动备份三表**）
//   npm run recalc:summary -- --restore=<备份>   # 从自动备份回滚
//   npm run recalc:summary -- --station=保定    # 只重算指定处（可重复传）
//   npm run recalc:summary -- --include-manual  # 连 manual 行一起重算（默认保护）
//   npm run recalc:summary -- --apply --allow-orphan-removal
//                                               # ⚠️ 放行「汇总站独有、明细侧无同名」的行（默认会中止）
//
// 护栏与 --allow-orphan-removal 的由来：
//   汇总站重算会**删除**「明细里已经没有」的行。若某行的名称在本处明细子站里找不到，
//   它可能是「被删子站残留的真设备」→ 默认**中止**，不静默丢数据。
//   2026-09-28 主人裁定「以台账为准」后，逐条核对台账 v3.4 全库 8046 行，
//   确认这些名字**全部 0 命中**（含「在建实体环境」站）→ 与第②步同口径，一并删。
//   放行时会：① 逐行打印；② 按 qty 分档统计；③ 把完整清单落盘到
//   `_tmp_ledger/summary_orphans_<时间戳>.json`（事后可逐条核对，不依赖终端回滚历史）。
//
// 备份：--apply 时先把 devices / stations / station_devices 快照到
//       _backup/summary_recalc_<时间戳>.json，不必再手工 pg_dump。
//
// 连接：本脚本由普通 node 启动（不经 PM2），**.env 不会自动生效** →
//       自己按 ecosystem.config.cjs 的做法加载 .env，并复刻 db.ts 的连接串口径
//       （DATABASE_URL 优先，否则用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 拼）。

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'
// 复用纯函数核心（esbuild 打包时把 .ts 一起编译进来）
import { planSummaryRecalc, SUMMARY_SUBSITE, NOT_SUMMARY_STATIONS } from '../server/utils/summarySite'

const APPLY = process.argv.includes('--apply')
const INCLUDE_MANUAL = process.argv.includes('--include-manual')
const HERE = dirname(fileURLToPath(import.meta.url))

/** 审计清单文件名用的时间戳（本地时间，形如 2026-09-28-15-18-05） */
const APPLY_FAIL_TAG = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

/** 逐级上溯探测项目根（打包后 import.meta.url 不再指向 scripts/，别依赖单一路径） */
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

/** --station=保定（可重复） */
const STATION_FILTER = process.argv
  .filter((a) => a.startsWith('--station='))
  .map((a) => a.slice('--station='.length).trim())
  .filter(Boolean)

/** --restore=<备份文件>：加护栏拦住「用空格」写错的情况，否则会被当成普通执行 */
const RESTORE_ARG = process.argv.find((a) => a === '--restore' || a.startsWith('--restore='))
const RESTORE_FILE = RESTORE_ARG ? RESTORE_ARG.slice('--restore='.length) : ''
if (RESTORE_ARG && !RESTORE_FILE) {
  console.error('✗ --restore 必须写成 --restore=<备份文件>（用等号，不要用空格）')
  console.error('   例：npm run recalc:summary -- --restore=_backup/summary_recalc_2026-09-21-10-00-00.json')
  process.exit(1)
}

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
  const file = join(BACKUP_DIR, `summary_recalc_${stamp}.json`)
  writeFileSync(file, JSON.stringify(dump))
  return { file, summary: BACKUP_TABLES.map((t) => `${t} ${dump.tables[t].rows.length}`).join(' · ') }
}

/** 读入并校验备份（纯本地，参数写错立刻报错，不必等连上库） */
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

/** 从快照原样回滚 */
async function restoreFrom(dump) {
  for (const t of BACKUP_TABLES) log(`   ${t}：${dump.tables[t].rows.length} 行`)

  // ⚠️ 必须同一条连接跑事务：pool.query 每次可能借出不同连接 → BEGIN 形同虚设
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 外键是 RESTRICT，必须从叶子往上删
    await client.query('DELETE FROM station_devices')
    for (let guard = 0; guard < 10; guard++) {
      const r = await client.query('DELETE FROM stations WHERE parent_id IS NOT NULL')
      if (!r.rowCount) break
    }
    await client.query('DELETE FROM stations WHERE parent_id IS NULL')
    await client.query('DELETE FROM devices')

    for (const t of ['devices', 'stations', 'station_devices']) {
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
    // 序列归位：显式带主键插入不推进 SERIAL
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

// ── 取数：一次性把三表读进内存（1.2 万行，够小），避免 N+1 查询 ──
async function loadAll() {
  const stations = (await pool.query('SELECT id, parent_id, name, level, is_summary, source FROM stations')).rows
  const devices = (await pool.query(
    'SELECT id, category, subcategory, name, brand_model, unit, unit_price FROM devices'
  )).rows
  const links = (await pool.query(
    'SELECT id, subsite_id, device_id, qty, remark, source FROM station_devices'
  )).rows
  return { stations, devices, links }
}

/** 三表快照 → 内存索引 */
function indexSnapshot({ stations, devices, links }) {
  const stById = new Map(stations.map((s) => [Number(s.id), s]))
  const devById = new Map(devices.map((d) => [Number(d.id), d]))
  const byParent = new Map() // parentId -> [子站]
  for (const s of stations) {
    if (s.parent_id == null) continue
    const p = Number(s.parent_id)
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p).push(s)
  }
  const linksBySub = new Map() // subsiteId -> [关联行]
  for (const l of links) {
    const k = Number(l.subsite_id)
    if (!linksBySub.has(k)) linksBySub.set(k, [])
    linksBySub.get(k).push(l)
  }
  return { stById, devById, byParent, linksBySub, stations, devices, links }
}

/** 由设备行算「同款键」——必须与 summarySite.ts 的 mergeKey 同口径 */
const devMergeKey = (d) =>
  JSON.stringify([
    d.category ?? '', d.subcategory ?? '', d.name ?? '',
    d.brand_model ?? '', d.unit ?? '',
    d.unit_price === null || d.unit_price === undefined ? null : Number(d.unit_price),
  ])

// ─────────────────────────────────────────────────────────────
async function main() {
  log(RESTORE_FILE
    ? '═══ 汇总站重算 · 回滚模式 ═══'
    : (APPLY ? '═══ 汇总站重算 · 执行模式 ═══' : '═══ 汇总站重算 · DRY-RUN（不写库）═══'))
  log(`目标库：${maskedTarget}`)
  log(`manual 行：${INCLUDE_MANUAL ? '⚠️ 一并重算（--include-manual）' : '受保护，不覆盖不删除'}`)

  let restoreDump = null
  if (RESTORE_FILE) {
    restoreDump = loadBackup(RESTORE_FILE)
    log(`回滚文件：${RESTORE_FILE}`)
  }
  if (STATION_FILTER.length) log(`只处理：${STATION_FILTER.join(' / ')}`)
  log('')

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

  if (RESTORE_FILE) {
    await restoreFrom(restoreDump)
    await pool.end()
    return
  }

  // ── 0) 执行前自动备份 ──
  let backupRel = null
  if (APPLY) {
    log('── 0) 执行前自动备份 ──')
    const snap = await snapshotTables()
    backupRel = relative(ROOT, snap.file)
    log(`   已备份：${snap.summary}`)
    log(`   备份文件：${backupRel}`)
    log(`   回滚命令：npm run recalc:summary -- --restore=${backupRel}\n`)
  }

  const snap = await loadAll()
  const { stById, devById, byParent, linksBySub } = indexSnapshot(snap)

  // ── 1) 找出所有管理处及其汇总站 ──
  const managers = snap.stations.filter((s) => s.parent_id == null).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  log(`── 1) 定位汇总站 ──`)
  log(`   库中管理处 ${managers.length} 个：${managers.map((m) => m.name).join(' / ')}`)

  const targets = []
  const skipped = []
  for (const m of managers) {
    if (STATION_FILTER.length && !STATION_FILTER.includes(m.name)) continue
    const subs = byParent.get(Number(m.id)) || []
    const sum = subs.filter((s) => s.name === SUMMARY_SUBSITE)
    if (!sum.length) { skipped.push(`${m.name}（无「${SUMMARY_SUBSITE}」站）`); continue }
    for (const s of sum) {
      // 廊涿 / 廊坊 / 总调中心：独立清单，当明细用，跳过
      if (NOT_SUMMARY_STATIONS.includes(m.name)) {
        skipped.push(`${m.name}（豁免：独立清单，当明细子站）`)
        continue
      }
      targets.push({ manager: m, summary: s, subsites: subs })
    }
  }
  if (skipped.length) log(`   跳过 ${skipped.length} 项：${skipped.join(' / ')}`)
  log(`   待重算 ${targets.length} 个汇总站\n`)

  if (!targets.length) {
    log('没有需要重算的汇总站。')
    await pool.end()
    return
  }

  // ── 2) 逐个算重算计划 ──
  log('── 2) 重算计划 ──')
  const plans = []
  for (const t of targets) {
    const mgrId = Number(t.manager.id)
    // 明细行 = 本处全部子站（除汇总站自己）的关联行
    const detailRows = []
    let detailSubCount = 0
    for (const s of t.subsites) {
      const sid = Number(s.id)
      if (sid === Number(t.summary.id)) continue
      detailSubCount++
      for (const l of linksBySub.get(sid) || []) {
        const d = devById.get(Number(l.device_id))
        if (!d) continue
        detailRows.push({
          subsite: s.name,
          device_id: Number(l.device_id),
          qty: l.qty === null ? null : Number(l.qty),
          category: d.category, subcategory: d.subcategory, name: d.name,
          brand_model: d.brand_model, unit: d.unit,
          unit_price: d.unit_price === null ? null : Number(d.unit_price),
        })
      }
    }
    // 汇总站现存行
    const sumId = Number(t.summary.id)
    const currentRows = (linksBySub.get(sumId) || []).map((l) => {
      const d = devById.get(Number(l.device_id))
      return {
        device_id: Number(l.device_id),
        qty: l.qty === null ? null : Number(l.qty),
        source: l.source,
        mergeKey: d ? devMergeKey(d) : '',
      }
    })

    const plan = planSummaryRecalc(detailRows, currentRows, { includeManual: INCLUDE_MANUAL })
    // 目标态里已在汇总站存在的行不算「新增」
    const curIds = new Set(currentRows.filter((r) => (INCLUDE_MANUAL ? true : r.source !== 'manual')).map((r) => r.device_id))
    const adds = plan.upserts.filter((u) => !curIds.has(u.device_id)).length
    const kept = plan.upserts.length - adds

    // ── 移除行的可读明细 + 安全护栏 ──
    // 移除 = 「汇总站有、明细里没有」。经验数据：A 类 7 处的这类行 100% 是
    // 「同款设备但单价/品牌/单位写法与明细不一致」的冗余行（按名称+单位都能在明细中找到），
    // 移除不会丢设备。但为防万一，这里逐行核对：若某行的**名称**在明细中完全不存在，
    // 说明它是汇总站独有的真实设备，直接移除会丢数据 → 拒绝执行。
    const detailNames = new Set(detailRows.map((r) => (r.name || '').trim()))
    const removalDetail = plan.removals.map((id) => {
      const d = devById.get(Number(id))
      const l = (linksBySub.get(sumId) || []).find((x) => Number(x.device_id) === Number(id))
      return {
        id,
        name: d?.name ?? '(设备已不存在)',
        sub: `${d?.category ?? ''}/${d?.subcategory ?? ''}`,
        spec: d?.brand_model ?? '',
        unit: d?.unit ?? '',
        price: d?.unit_price ?? null,
        qty: l?.qty ?? null,
        known: detailNames.has((d?.name ?? '').trim()),
      }
    })
    const unknown = removalDetail.filter((r) => !r.known)

    plans.push({ ...t, plan, adds, kept, detailSubCount, detailRows: detailRows.length, removalDetail, unknown })

    log(`   ${t.manager.name} / ${SUMMARY_SUBSITE}`)
    log(`     明细：${detailSubCount} 个子站 · ${detailRows.length} 行`)
    log(`     汇总站现状：${currentRows.length} 行 → 重算后 ${plan.upserts.length} 行（沿用 ${kept} / 新增 ${adds} / 移除 ${plan.removals.length}）`)
    log(`     数量变更 ${plan.changed} 行 · 不变 ${plan.unchanged} 行${plan.protectedManual ? ` · 保护 manual ${plan.protectedManual} 行` : ''}`)
    log(`     数量合计：${plan.qtyBefore} → ${plan.qtyAfter}`)
    for (const r of removalDetail) {
      log(`     ${r.known ? '− ' : '⚠ '}移除 [${r.sub}] ${r.name} | ${r.spec} | ${r.unit} | 单价${r.price} | 数量${r.qty}` +
        (r.known ? '（名称在明细中存在 → 冗余行）' : '（⚠️ 名称在明细中不存在 → 可能是真实设备！）'))
    }
  }

  // ── 护栏：有「名称在明细里找不到」的移除行 → 拒绝执行（宁可不动，也不能静默丢设备）──
  //
  // 背景（2026-09-28 实测）：执行 align:ledger 删掉 7 个「台账无此子站」的子站后，
  //   汇总站里仍残留这些子站的设备行 → 重算时明细侧找不到同名设备 → 护栏报红 217 行。
  //   ⚠️ 这 217 行里既有 qty=0 的空行占位，也有 qty>0 的真实施工量（保沧通信施工 21 行、
  //      保沧/廊涿安全监测 16 行、保沧核心节点 MDF配线柜/调度台/软交换/MDF告警监测终端 4 行）。
  //   逐条核对台账 v3.4 全库 8046 行：这些名字**全部 0 命中**（含「在建实体环境」站）。
  //   → 主人裁定「以台账为准」= 与第②步同口径，一并删除。
  //
  // 为什么不用 --force-remove 直接放行：它无差别绕过，连「汇总站独有的真设备」也一起吞。
  //   本参数改为**带审计的放行**：逐行打印 + 按 qty 分档统计 + 落盘清单，删了什么一目了然。
  const guarded = plans.filter((p) => p.unknown.length)
  const ALLOW_ORPHAN = process.argv.includes('--allow-orphan-removal')
  if (guarded.length) {
    const total = guarded.reduce((a, p) => a + p.unknown.length, 0)
    const withQty = guarded.reduce((a, p) => a + p.unknown.filter((r) => Number(r.qty) > 0).length, 0)
    log('\n══ 护栏：汇总站独有行（明细侧无同名设备）══')
    log(`   ${guarded.length} 个汇总站 · ${total} 行（其中 qty>0 的 ${withQty} 行）`)
    for (const p of guarded) {
      const q = p.unknown.filter((r) => Number(r.qty) > 0)
      log(`   · ${p.manager.name}：${p.unknown.length} 行（qty>0 的 ${q.length} 行）`)
    }

    // 落盘完整清单（便于事后逐条核对，不依赖终端回滚历史）
    const auditDir = join(ROOT, '_tmp_ledger')
    if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true })
    const auditFile = join(auditDir, `summary_orphans_${APPLY_FAIL_TAG}.json`)
    const audit = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry-run',
      note: '汇总站独有的待移除行（明细子站中无同名设备）。主人裁定口径：以台账为准，一并删除。',
      total, withQty,
      byManager: guarded.map((p) => ({
        manager: p.manager.name,
        total: p.unknown.length,
        withQty: p.unknown.filter((r) => Number(r.qty) > 0).length,
        rows: p.unknown.map((r) => ({ name: r.name, spec: r.spec, unit: r.unit, price: r.price, qty: r.qty, sub: r.sub })),
      })),
    }
    writeFileSync(auditFile, JSON.stringify(audit, null, 2))
    log(`   清单已落盘：${relative(ROOT, auditFile)}`)

    if (APPLY) {
      if (!ALLOW_ORPHAN && !process.argv.includes('--force-remove')) {
        log('\n✗ 中止：以上行在明细子站找不到同名设备，疑似真实设备，拒绝执行。')
        log('   请人工确认后处理：这些设备要么补进明细子站，要么确认可删。')
        log('   以台账为准（台账全库无此名）时，可加 --allow-orphan-removal 放行（会打印审计清单）。')
        log('   不加参数地无差别绕过用 --force-remove（不推荐）。')
        await pool.end()
        process.exit(1)
      }
      log(`   ⚠️ 检测到 ${ALLOW_ORPHAN ? '--allow-orphan-removal' : '--force-remove'}，继续执行。`)
      log(`   执行后将删除上述 ${total} 行（qty>0 的 ${withQty} 行，合计数量 ${guarded.reduce((a, p) => a + p.unknown.reduce((s, r) => s + (Number(r.qty) || 0), 0), 0)}）。`)
    } else {
      log('   （dry-run：未改动数据。--apply 会中止，除非显式放行。）')
    }
  }

  // ── 3) 执行 ──
  const touched = plans.filter((p) => p.adds || p.plan.removals.length || p.plan.changed)
  log('')
  log(`── 3) 执行 ──`)
  log(`   需改动 ${touched.length} 个汇总站（其余 ${plans.length - touched.length} 个已是目标态）`)

  if (APPLY && touched.length) {
    const client = await pool.connect()
    let ins = 0, upd = 0, del = 0
    try {
      await client.query('BEGIN')
      for (const p of touched) {
        const sumId = Number(p.summary.id)
        // 3.1 删除：明细里已不存在的（manual 已由 plan 排除）
        if (p.plan.removals.length) {
          const r = await client.query(
            'DELETE FROM station_devices WHERE subsite_id = $1 AND device_id = ANY($2::int[])',
            [sumId, p.plan.removals]
          )
          del += r.rowCount
        }
        // 3.2 写入：一条 SQL 完成「插入 / 更新数量」，但绝不覆盖 manual
        for (const u of p.plan.upserts) {
          const r = await client.query(
            `INSERT INTO station_devices (subsite_id, device_id, qty, remark, source)
             VALUES ($1, $2, $3, NULL, 'seed')
             ON CONFLICT (subsite_id, device_id)
             DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()
             WHERE station_devices.source <> 'manual'
             RETURNING (xmax = 0) AS inserted`,
            [sumId, u.device_id, u.qty]
          )
          if (!r.rows.length) continue          // 命中 manual → 未写入
          if (r.rows[0].inserted) ins++
          else upd++
        }
      }
      await client.query('COMMIT')
      log(`   写入完成：新增 ${ins} 行 · 更新 ${upd} 行 · 删除 ${del} 行`)
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  } else if (!touched.length) {
    log('   ✓ 全部汇总站均已是目标态（重复执行到此即 0 变化）')
  }

  // ── 4) 执行后核对（重算一遍，应当全 0） ──
  if (APPLY && touched.length) {
    log('\n── 4) 执行后复核 ──')
    const after = indexSnapshot(await loadAll())
    let totalDrift = 0
    for (const p of plans) {
      const sumId = Number(p.summary.id)
      const detailRows = []
      for (const s of p.subsites) {
        const sid = Number(s.id)
        if (sid === sumId) continue
        for (const l of after.linksBySub.get(sid) || []) {
          const d = after.devById.get(Number(l.device_id))
          if (!d) continue
          detailRows.push({
            subsite: s.name, device_id: Number(l.device_id),
            qty: l.qty === null ? null : Number(l.qty),
            category: d.category, subcategory: d.subcategory, name: d.name,
            brand_model: d.brand_model, unit: d.unit,
            unit_price: d.unit_price === null ? null : Number(d.unit_price),
          })
        }
      }
      const currentRows = (after.linksBySub.get(sumId) || []).map((l) => {
        const d = after.devById.get(Number(l.device_id))
        return {
          device_id: Number(l.device_id),
          qty: l.qty === null ? null : Number(l.qty),
          source: l.source,
          mergeKey: d ? devMergeKey(d) : '',
        }
      })
      const v = planSummaryRecalc(detailRows, currentRows, { includeManual: INCLUDE_MANUAL })
      const drift = v.changed + v.removals.length
      // 目标态里有、汇总站没有的（= 被 manual 挡住的）单独列出
      const curIds = new Set(currentRows.map((r) => r.device_id))
      const blocked = v.upserts.filter((u) => !curIds.has(u.device_id)).length
      totalDrift += drift
      log(`   ${p.manager.name}：残余差异 ${drift} 行${blocked ? ` · 被 manual 挡住 ${blocked} 行` : ''}`)
    }
    log(totalDrift === 0
      ? '   ✓ 全部汇总站已等于明细累加结果'
      : `   ⚠️ 仍有 ${totalDrift} 行差异，请检查上面各处的明细`)
  }

  // ── 汇总 ──
  log('\n═══ 汇总 ═══')
  const sumAdds = plans.reduce((a, p) => a + p.adds, 0)
  const sumDel = plans.reduce((a, p) => a + p.plan.removals.length, 0)
  const sumChg = plans.reduce((a, p) => a + p.plan.changed, 0)
  log(`汇总站 ${plans.length} 个：新增 ${sumAdds} 行 · 数量变更 ${sumChg} 行 · 移除 ${sumDel} 行`)
  log(`数量合计 ${plans.reduce((a, p) => a + p.plan.qtyBefore, 0)} → ${plans.reduce((a, p) => a + p.plan.qtyAfter, 0)}`)
  if (APPLY) {
    const after = {
      devices: Number((await pool.query('SELECT COUNT(*)::int c FROM devices')).rows[0].c),
      links: Number((await pool.query('SELECT COUNT(*)::int c FROM station_devices')).rows[0].c),
      stations: Number((await pool.query('SELECT COUNT(*)::int c FROM stations')).rows[0].c),
    }
    log(`\n执行后：设备 ${after.devices} 行 · 关联 ${after.links} 行 · 站点 ${after.stations} 行`)
    if (backupRel) log(`\n如需回滚：npm run recalc:summary -- --restore=${backupRel}`)
  } else {
    log('\n这是 DRY-RUN，未改动任何数据。确认无误后执行：')
    log('   npm run recalc:summary -- --apply')
    log('（--apply 会先把三张表自动备份到 _backup/，无需手工 pg_dump）')
  }
  await pool.end()
}

main().catch(async (e) => {
  console.error('✗ 执行失败：', e.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
