#!/usr/bin/env node
// 造价标准域：三张平级冗余表 → 一主多从（standards + standard_benchmarks + standard_parameters）
// 并给地区计价两张表（provincial_pricing / city_rates）补唯一键，供 Excel 批量 upsert。
//
// 【何时跑】只需在服务器手动执行一次。可重复执行（幂等）。
// 【用法】
//   先出体检报告（只读，绝不写库）：
//     node scripts/migrate_standards_3nf.mjs
//   确认报告无误后真正迁移：
//     node scripts/migrate_standards_3nf.mjs --apply
//
// 【安全保证】
//   1. 默认 dry-run：只 SELECT，不写任何数据
//   2. --apply 时先把三张旧表备份为 *_bak_20260902（已存在则跳过，绝不覆盖旧备份）
//   3. 只写新表，**绝不删除/修改 standards、estimation_benchmarks、estimation_parameters**，随时可回退
//   4. 唯一索引在创建前先查重，有重复则跳过并警告，绝不因此中断（DDL 失败会导致应用全站 500）

import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run'
const BAK_SUFFIX = 'bak_20260902'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

function safeParse(v, def) {
  if (v == null) return def
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return def }
  }
  return v
}

const line = (s = '') => console.log(s)
const hr = (t) => { line(); line(`── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`) }

async function main() {
  const url = resolveDatabaseUrl()
  if (!url) {
    console.error('× 未找到 DATABASE_URL。请在服务器项目根目录执行（会读取 .env），或显式传入：')
    console.error('  DATABASE_URL=postgres://... node scripts/migrate_standards_3nf.mjs')
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString: url })
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows

  try {
    line(`模式：${MODE === 'apply' ? '★ 真实迁移（会写库）' : '○ 体检（只读，不写库）'}`)

    // ── 1) 盘点现状 ────────────────────────────────────────────────
    hr('1. 现状盘点')
    const cnt = async (t) => Number((await q(`SELECT COUNT(*)::int AS c FROM ${t}`))[0].c)
    const counts = {
      standards: await cnt('standards'),
      estimation_benchmarks: await cnt('estimation_benchmarks'),
      estimation_parameters: await cnt('estimation_parameters'),
      provincial_pricing: await cnt('provincial_pricing'),
      city_rates: await cnt('city_rates'),
    }
    for (const [t, c] of Object.entries(counts)) line(`  ${t.padEnd(24)} ${c} 条`)

    const newExists = async (t) => (await q(
      `SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = $1`, [t]
    ))[0].c > 0
    for (const t of ['standard_benchmarks', 'standard_parameters']) {
      if (await newExists(t)) line(`  ${t.padEnd(24)} ${await cnt(t)} 条 （新表已存在，迁移将增量追加）`)
      else line(`  ${t.padEnd(24)} 尚未创建`)
    }

    // ── 2) benchmarks → standards 匹配分析 ────────────────────────
    hr('2. estimation_benchmarks → standards 匹配')
    const stdList = await q('SELECT id, code, name FROM standards')
    const byCode = new Map(stdList.filter((s) => s.code).map((s) => [s.code, s]))
    const byName = new Map(stdList.map((s) => [s.name, s]))
    const bms = await q('SELECT id, standard_code, standard_name FROM estimation_benchmarks')

    const bmMatched = []
    const bmOrphan = []
    for (const b of bms) {
      const hit = (b.standard_code && byCode.get(b.standard_code)) || byName.get(b.standard_name)
      if (hit) bmMatched.push({ b, std: hit, via: b.standard_code && byCode.get(b.standard_code) ? 'code' : 'name' })
      else bmOrphan.push(b)
    }
    line(`  可匹配：${bmMatched.length} / ${bms.length}`)
    for (const m of bmMatched) line(`    ✓ ${m.b.standard_name} → standards.id=${m.std.id}  （按 ${m.via} 匹配）`)
    if (bmOrphan.length) {
      line(`  匹配不上（将成为孤儿，不迁移）：${bmOrphan.length}`)
      for (const b of bmOrphan) line(`    × ${b.standard_name || b.standard_code || b.id}`)
    }

    // ── 3) parameters → standards 匹配分析 ────────────────────────
    hr('3. estimation_parameters → standards 匹配')
    const stdIds = new Set(stdList.map((s) => s.id))
    const eps = await q('SELECT id, standard_id, param_name FROM estimation_parameters')
    const epOk = eps.filter((p) => stdIds.has(p.standard_id))
    const epBad = eps.filter((p) => !stdIds.has(p.standard_id))
    line(`  外键有效：${epOk.length} / ${eps.length}`)
    if (epBad.length) {
      line(`  指向不存在的标准（不迁移）：${epBad.length}`)
      const badIds = [...new Set(epBad.map((p) => p.standard_id))].slice(0, 10)
      for (const id of badIds) line(`    × standard_id=${id}  （${epBad.filter((p) => p.standard_id === id).length} 条）`)
    }

    // ── 4) standards.params JSON 拆行分析 ─────────────────────────
    hr('4. standards.params / param_values JSON 拆行')
    let jsonRows = 0
    let jsonDup = 0
    const stdWithJson = await q('SELECT id, name, params, param_values FROM standards')
    for (const s of stdWithJson) {
      const names = safeParse(s.params, [])
      if (!Array.isArray(names) || !names.length) continue
      const vals = safeParse(s.param_values, {}) || {}
      const own = new Set()
      for (const n of names) {
        if (own.has(n)) { jsonDup++; continue }
        own.add(n)
        jsonRows++
      }
      void vals
    }
    line(`  可拆出参数行：${jsonRows} 条（来自 ${stdWithJson.filter((s) => (safeParse(s.params, []) || []).length).length} 份标准）`)
    if (jsonDup) line(`  ⚠ 同一标准内参数名重复：${jsonDup} 条（迁移时自动去重）`)

    // 与 estimation_parameters 的重名冲突
    const epByStd = new Map()
    for (const p of epOk) {
      if (!epByStd.has(p.standard_id)) epByStd.set(p.standard_id, new Set())
      epByStd.get(p.standard_id).add(p.param_name)
    }
    let crossDup = 0
    for (const s of stdWithJson) {
      const names = safeParse(s.params, [])
      if (!Array.isArray(names)) continue
      const exist = epByStd.get(s.id)
      if (!exist) continue
      for (const n of names) if (exist.has(n)) crossDup++
    }
    line(`  与 estimation_parameters 重名（迁移时以 estimation_parameters 为准，跳过）：${crossDup} 条`)

    // ── 5) 地区计价表重复检查（决定能否建唯一索引）─────────────────
    hr('5. 地区计价表唯一键检查')
    const ppDup = await q(`
      SELECT region, level, year, COUNT(*)::int AS c FROM provincial_pricing
      GROUP BY region, level, year HAVING COUNT(*) > 1`)
    line(`  provincial_pricing (region+level+year) 重复组：${ppDup.length}`)
    for (const d of ppDup.slice(0, 10)) line(`    × ${d.region} / ${d.level} / ${d.year} → ${d.c} 条`)

    const crDup = await q(`
      SELECT city, year, rate_type, COALESCE(benchmark_org,'<NULL>') AS org, COUNT(*)::int AS c
      FROM city_rates GROUP BY city, year, rate_type, COALESCE(benchmark_org,'<NULL>') HAVING COUNT(*) > 1`)
    line(`  city_rates (city+year+rate_type+org) 重复组：${crDup.length}`)
    for (const d of crDup.slice(0, 10)) line(`    × ${d.city} / ${d.year} / ${d.rate_type} / ${d.org} → ${d.c} 条`)

    const crNullOrg = Number((await q('SELECT COUNT(*)::int AS c FROM city_rates WHERE benchmark_org IS NULL'))[0].c)
    if (crNullOrg) line(`  ⚠ city_rates 有 ${crNullOrg} 条 benchmark_org 为空，唯一索引对 NULL 不去重，需先填充`)

    // ── 6) 结论 ────────────────────────────────────────────────────
    hr('结论')
    const plan = []
    plan.push(`standard_benchmarks  将写入 ${bmMatched.length} 条${bmOrphan.length ? `（${bmOrphan.length} 条孤儿跳过）` : ''}`)
    plan.push(`standard_parameters  将写入 ${epOk.length + (jsonRows - crossDup)} 条（参数明细 ${epOk.length} + JSON 拆行 ${jsonRows - crossDup}）`)
    plan.push(`provincial_pricing   唯一索引 ${ppDup.length === 0 ? '可建' : '暂不可建（需先清理重复）'}`)
    plan.push(`city_rates           唯一索引 ${crDup.length === 0 && crNullOrg === 0 ? '可建' : '暂不可建（需先清理重复或填 benchmark_org）'}`)
    for (const p of plan) line(`  · ${p}`)

    if (MODE === 'dry-run') {
      hr('下一步')
      line('  以上为只读体检，未修改任何数据。')
      line('  确认无误后执行真实迁移：')
      line('    node scripts/migrate_standards_3nf.mjs --apply')
      return
    }

    // ── 7) 真实迁移 ────────────────────────────────────────────────
    hr('★ 开始迁移')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // 7.1 备份三张旧表
      for (const t of ['standards', 'estimation_benchmarks', 'estimation_parameters']) {
        const bak = `${t}_${BAK_SUFFIX}`
        const has = (await client.query(
          'SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_name = $1', [bak]
        )).rows[0].c > 0
        if (has) { line(`  备份 ${bak} 已存在，跳过（不覆盖）`); continue }
        await client.query(`CREATE TABLE ${bak} AS TABLE ${t}`)
        line(`  已备份 ${t} → ${bak}`)
      }

      // 7.2 建新表（幂等）
      await client.query(`
        CREATE TABLE IF NOT EXISTS standard_benchmarks (
          id                 SERIAL PRIMARY KEY,
          standard_id        TEXT NOT NULL,
          ufp_method         TEXT,
          ufp_weights        TEXT,
          reuse_factors      TEXT,
          cf                 TEXT,
          pdr                TEXT,
          hm                 NUMERIC,
          rate               NUMERIC,
          adjustment_factors TEXT,
          source             TEXT,
          created_at         TIMESTAMPTZ DEFAULT now(),
          updated_at         TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS standard_parameters (
          id              SERIAL PRIMARY KEY,
          standard_id     TEXT NOT NULL,
          param_category  TEXT,
          param_name      TEXT NOT NULL,
          param_type      TEXT,
          unit            TEXT,
          values          TEXT,
          description     TEXT,
          seq             INTEGER DEFAULT 0,
          created_at      TIMESTAMPTZ DEFAULT now(),
          updated_at      TIMESTAMPTZ DEFAULT now()
        );
      `)

      // 7.3 迁移测算参数（1:1）
      let nBm = 0
      for (const m of bmMatched) {
        const src = (await client.query('SELECT * FROM estimation_benchmarks WHERE id = $1', [m.b.id])).rows[0]
        const exist = (await client.query('SELECT id FROM standard_benchmarks WHERE standard_id = $1', [m.std.id])).rows[0]
        const payload = [
          m.std.id, src.ufp_method, src.ufp_weights, src.reuse_factors, src.cf,
          src.pdr, src.hm, src.rate, src.adjustment_factors, src.source || 'seed',
        ]
        if (exist) {
          await client.query(
            `UPDATE standard_benchmarks SET ufp_method=$2, ufp_weights=$3, reuse_factors=$4, cf=$5,
                    pdr=$6, hm=$7, rate=$8, adjustment_factors=$9, source=$10, updated_at=now()
             WHERE standard_id=$1`, payload)
        } else {
          await client.query(
            `INSERT INTO standard_benchmarks
               (standard_id, ufp_method, ufp_weights, reuse_factors, cf, pdr, hm, rate, adjustment_factors, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, payload)
          nBm++
        }
      }
      line(`  standard_benchmarks  ${nBm} 条`)

      // 7.4 迁移参数明细（1:N）——先 estimation_parameters，再补 JSON 拆行
      let nEp = 0
      for (const p of epOk) {
        const src = (await client.query('SELECT * FROM estimation_parameters WHERE id = $1', [p.id])).rows[0]
        const exist = (await client.query(
          'SELECT id FROM standard_parameters WHERE standard_id = $1 AND param_name = $2', [src.standard_id, src.param_name]
        )).rows[0]
        if (exist) continue
        await client.query(
          `INSERT INTO standard_parameters (standard_id, param_category, param_name, param_type, unit, values, description, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [src.standard_id, src.param_category, src.param_name, src.param_type, src.unit, src.values, src.description, src.seq || 0]
        )
        nEp++
      }
      line(`  standard_parameters  来自参数明细 ${nEp} 条`)

      let nJson = 0
      for (const s of stdWithJson) {
        const names = safeParse(s.params, [])
        if (!Array.isArray(names) || !names.length) continue
        const vals = safeParse(s.param_values, {}) || {}
        let seq = 9000
        for (const n of names) {
          if (epByStd.get(s.id)?.has(n)) continue
          const exist = (await client.query(
            'SELECT id FROM standard_parameters WHERE standard_id = $1 AND param_name = $2', [s.id, n]
          )).rows[0]
          if (exist) continue
          const v = vals[n]
          await client.query(
            `INSERT INTO standard_parameters (standard_id, param_category, param_name, param_type, unit, values, description, seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [s.id, '未分类', n, typeof v === 'number' ? 'factor' : 'text', null, JSON.stringify(v ?? null), '由 standards.param_values 拆行迁入', seq++]
          )
          nJson++
        }
      }
      line(`  standard_parameters  来自 JSON 拆行 ${nJson} 条`)

      // 7.5 唯一索引（先查重，有重复则跳过并警告，绝不中断）
      await client.query('CREATE INDEX IF NOT EXISTS idx_sp_std ON standard_parameters(standard_id)')
      if (ppDup.length === 0) {
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_pp_region_level_year ON provincial_pricing(region, level, year)')
        line('  ✓ provincial_pricing 唯一索引已建')
      } else {
        line(`  ⚠ provincial_pricing 有 ${ppDup.length} 组重复，跳过唯一索引（请先清理）`)
      }
      if (crDup.length === 0 && crNullOrg === 0) {
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_cr_city_year_type_org ON city_rates(city, year, rate_type, benchmark_org)')
        line('  ✓ city_rates 唯一索引已建')
      } else {
        line(`  ⚠ city_rates 有 ${crDup.length} 组重复 / ${crNullOrg} 条空 org，跳过唯一索引（请先清理）`)
      }

      await client.query('COMMIT')
      hr('迁移完成')
      line('  旧表未删除，已备份为 *_' + BAK_SUFFIX + '，可随时回退。')
    } catch (e) {
      await client.query('ROLLBACK')
      line(`× 迁移失败，已整段回滚：${e.message}`)
      throw e
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
