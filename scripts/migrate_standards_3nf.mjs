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
// --create-missing：为 estimation_parameters 里标准库缺失的标准，用参数自带的元信息补建 standards 记录再挂载
const MISSING_CREATE = process.argv.includes('--create-missing')
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

// 标准编号归一化：破折号/连字符统一、全角括号转半角、去空格、转小写。
// 用于跨表按编号匹配时容错（如 DB 11/T 1010—2019 与 DB11/T 1010-2019、豫财预〔2024〕105号 与 豫财预(2024)105号）。
function normCode(c) {
  if (!c) return ''
  return String(c)
    .replace(/[—–−]/g, '-')          // 长破折号/短破折号/减号 → 连字符
    .replace(/[〔【]/g, '(')         // 全角左括号 → 半角
    .replace(/[〕】]/g, ')')         // 全角右括号 → 半角
    .replace(/\s+/g, '')            // 去所有空白
    .toLowerCase()
    .trim()
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
    const byCodeNorm = new Map(stdList.filter((s) => s.code).map((s) => [normCode(s.code), s]))
    const byName = new Map(stdList.map((s) => [s.name, s]))
    const bms = await q('SELECT id, standard_code, standard_name FROM estimation_benchmarks')

    const bmMatched = []
    const bmOrphan = []
    for (const b of bms) {
      const hitCode = (b.standard_code && byCode.get(b.standard_code)) || (b.standard_code && byCodeNorm.get(normCode(b.standard_code)))
      const hit = hitCode || byName.get(b.standard_name)
      if (hit) bmMatched.push({ b, std: hit, via: hitCode ? 'code' : 'name' })
      else bmOrphan.push(b)
    }
    line(`  可匹配：${bmMatched.length} / ${bms.length}`)
    for (const m of bmMatched) line(`    ✓ ${m.b.standard_name} → standards.id=${m.std.id}  （按 ${m.via} 匹配）`)
    if (bmOrphan.length) {
      line(`  匹配不上（将成为孤儿，不迁移）：${bmOrphan.length}`)
      for (const b of bmOrphan) line(`    × ${b.standard_name || b.standard_code || b.id}`)
    }

    // ── 3) parameters → standards 匹配分析 ────────────────────────
    // estimation_parameters.standard_id 用的是另一套命名（如 scsia-0015-2025），
    // 跟 standards.id（如 sc-t-0015）对不上，需靠 standard_code / standard_name 兜底。
    hr('3. estimation_parameters → standards 匹配')
    const stdIds = new Set(stdList.map((s) => s.id))
    const stdById = new Map(stdList.map((s) => [s.id, s]))
    const nameHits = (n) => stdList.filter((s) => s.name && n && (s.name === n || s.name.includes(n) || n.includes(s.name)))

    // 人工兜底映射：参数 standard_id → 标准库 id（或 '__CREATE__' 表示库内无对应、交由 --create-missing 新建）。
    // 仅用于自动匹配仍误挂/分歧的情况，使迁移结果确定且正确。修改前请主人确认。
    const OVERRIDE = {
      'csbsg-2021': 'csia-ssmbk',      // 中国软件行业基准数据报告(SSM-BK-202109) → 是"报告"而非 CSBMK 基准数据
      'csbmk-2025': 'bscea-csbmk',     // 中国软件行业基准数据（2025）→ 同一 CSBMK 基准的 2025 版
      'db11-1424-2017': '__CREATE__',  // 北京运维 DB11/T 1424-2017 库内无对应标准 → 新建（勿误挂 GB/T 28827.7）
    }
    const eps = await q('SELECT id, standard_id, standard_code, standard_name, param_name FROM estimation_parameters')

    // 按 standard_id 分组做匹配，避免重复计算
    const groupMap = new Map()
    for (const p of eps) {
      if (!groupMap.has(p.standard_id)) groupMap.set(p.standard_id, { src: p, count: 0 })
      groupMap.get(p.standard_id).count++
    }
    const matchById = new Map()   // 原 standard_id → 匹配结果
    const epOk = []
    const epBad = []
    const groups = []
    for (const [sid, g] of groupMap) {
      const p = g.src
      let m
      const ov = OVERRIDE[sid]
      if (ov === '__CREATE__') {
        m = { conf: 'none' }
      } else if (ov && stdById.get(ov)) {
        m = { std: stdById.get(ov), via: 'override', conf: 'exact' }
      } else if (stdIds.has(sid)) {
        m = { std: stdList.find((s) => s.id === sid), via: 'id', conf: 'exact' }
      } else if (p.standard_code && byCode.get(p.standard_code)) {
        m = { std: byCode.get(p.standard_code), via: 'code', conf: 'exact' }
      } else if (p.standard_code && byCodeNorm.get(normCode(p.standard_code))) {
        m = { std: byCodeNorm.get(normCode(p.standard_code)), via: 'code(归一化)', conf: 'exact' }
      } else {
        const exact = stdList.find((s) => s.name === p.standard_name)
        if (exact) m = { std: exact, via: 'name', conf: 'exact' }
        else {
          const fuzzy = nameHits(p.standard_name)
          if (fuzzy.length === 1) m = { std: fuzzy[0], via: 'name-fuzzy', conf: 'fuzzy' }
          else if (fuzzy.length > 1) m = { candidates: fuzzy, conf: 'ambiguous' }
          else m = { conf: 'none' }
        }
      }
      matchById.set(sid, m)
      groups.push({ sid, ...g, m })
    }
    const epOkWithConf = []
    for (const p of eps) {
      const m = matchById.get(p.standard_id)
      if (m && m.std) { epOk.push({ p, std: m.std }); epOkWithConf.push({ p, std: m.std, conf: m.conf }) }
      else if (m && m.candidates) epOkWithConf.push({ p, std: null, conf: 'ambiguous' })
      else epBad.push(p)
    }

    line(`  按参数行统计：可匹配 ${epOk.length} / ${eps.length}`)
    const ICON = { exact: '✓', fuzzy: '≈', ambiguous: '?', none: '×' }
    const CONF_TXT = { exact: '精确', fuzzy: '模糊（需人工确认）', ambiguous: '多候选（需人工指定）', none: '未匹配' }
    for (const g of groups) {
      const m = g.m
      if (m.std) {
        line(`  ${ICON[m.conf]} ${g.sid}  (${g.count} 条) → standards.id=${m.std.id}`)
        line(`      参数侧名称：${g.src.standard_name}`)
        line(`      标准库名称：${m.std.name}   【按 ${m.via} 匹配 · ${CONF_TXT[m.conf]}】`)
      } else if (m.candidates) {
        line(`  ${ICON.ambiguous} ${g.sid}  (${g.count} 条) → 匹配到 ${m.candidates.length} 个候选，需人工指定`)
        line(`      参数侧名称：${g.src.standard_name}`)
        for (const c of m.candidates) line(`        候选：${c.id}  ${c.name}`)
      } else {
        line(`  ${ICON.none} ${g.sid}  (${g.count} 条) → 标准库无对应，建议按参数元信息新建标准`)
        line(`      名称：${g.src.standard_name}   编号：${g.src.standard_code || '—'}`)
      }
    }
    line()
    line(`  精确匹配组：${groups.filter((g) => g.m.conf === 'exact').length}` +
         `　模糊：${groups.filter((g) => g.m.conf === 'fuzzy').length}` +
         `　多候选：${groups.filter((g) => g.m.conf === 'ambiguous').length}` +
         `　未匹配：${groups.filter((g) => g.m.conf === 'none').length}`)

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
    for (const { p, std } of epOk) {
      if (!epByStd.has(std.id)) epByStd.set(std.id, new Set())
      epByStd.get(std.id).add(p.param_name)
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
    const nExact = groups.filter((g) => g.m.conf === 'exact').reduce((a, g) => a + g.count, 0)
    const nFuzzy = groups.filter((g) => g.m.conf === 'fuzzy').reduce((a, g) => a + g.count, 0)
    const nAmb = groups.filter((g) => g.m.conf === 'ambiguous').reduce((a, g) => a + g.count, 0)
    const nNone = groups.filter((g) => g.m.conf === 'none').reduce((a, g) => a + g.count, 0)
    plan.push(`standard_parameters  将写入 ${epOk.length + (jsonRows - crossDup)} 条` +
              `（参数明细 ${epOk.length} = 精确 ${nExact} + 模糊 ${nFuzzy}，JSON 拆行 ${jsonRows - crossDup}）`)
    if (nAmb) plan.push(`⚠ 多候选待人工指定：${nAmb} 条（本次不迁移）`)
    if (nNone) plan.push(`⚠ 标准库缺失：${nNone} 条${MISSING_CREATE ? '（将用 --create-missing 补建标准）' : '（加 --create-missing 可自动补建标准）'}`)
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
      // 策略：exact/fuzzy 组迁移（fuzzy 会在结束时提醒复核）；ambiguous 组跳过等人工指定；
      //       none 组仅当传了 --create-missing 时，用参数自带的元信息在 standards 里补建标准后再挂。
      let nEp = 0
      let nSkipAmb = 0
      let nNewStd = 0
      const fuzzyForReview = []
      for (const { p, std, conf } of epOkWithConf) {
        if (conf === 'ambiguous') { nSkipAmb++; continue }
        const src = (await client.query('SELECT * FROM estimation_parameters WHERE id = $1', [p.id])).rows[0]
        const exist = (await client.query(
          'SELECT id FROM standard_parameters WHERE standard_id = $1 AND param_name = $2', [std.id, src.param_name]
        )).rows[0]
        if (exist) continue
        await client.query(
          `INSERT INTO standard_parameters (standard_id, param_category, param_name, param_type, unit, values, description, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [std.id, src.param_category, src.param_name, src.param_type, src.unit, src.values, src.description, src.seq || 0]
        )
        nEp++
        if (conf === 'fuzzy') fuzzyForReview.push(`${std.id} ← ${src.standard_name}`)
      }
      line(`  standard_parameters  来自参数明细 ${nEp} 条${nSkipAmb ? `（跳过多候选 ${nSkipAmb} 条）` : ''}`)

      // 7.4b 为标准库缺失的标准补建记录（需 --create-missing）
      if (MISSING_CREATE) {
        const missingGroups = groups.filter((g) => g.m.conf === 'none')
        for (const g of missingGroups) {
          const p = (await client.query('SELECT * FROM estimation_parameters WHERE standard_id = $1 LIMIT 1', [g.sid])).rows[0]
          if (!p) continue
          const newId = `auto-${g.sid}`
          const exist = (await client.query('SELECT id FROM standards WHERE id = $1', [newId])).rows[0]
          if (!exist) {
            await client.query(
              `INSERT INTO standards (id, category, name, code, region, org, summary, source, is_enabled)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'seed',true)`,
              [newId, p.category || '其他', p.standard_name, p.standard_code || null, p.region || null, p.org || null,
               `迁移脚本自动补建：原 estimation_parameters.standard_id=${g.sid}`]
            )
            nNewStd++
            line(`  + 补建标准 ${newId}  ${p.standard_name}`)
          }
          const rows = (await client.query('SELECT * FROM estimation_parameters WHERE standard_id = $1', [g.sid])).rows
          let n = 0
          for (const src of rows) {
            const dup = (await client.query(
              'SELECT id FROM standard_parameters WHERE standard_id = $1 AND param_name = $2', [newId, src.param_name]
            )).rows[0]
            if (dup) continue
            await client.query(
              `INSERT INTO standard_parameters (standard_id, param_category, param_name, param_type, unit, values, description, seq)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [newId, src.param_category, src.param_name, src.param_type, src.unit, src.values, src.description, src.seq || 0]
            )
            n++
          }
          line(`     └ 挂载参数 ${n} 条`)
        }
      }

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
      if (nNewStd) line(`  补建标准 ${nNewStd} 条（id 前缀 auto-，请在 /admin/data 核对后补充分类与摘要）`)
      if (fuzzyForReview.length) {
        line()
        line('  ⚠ 以下为模糊匹配，请人工复核是否挂对了标准：')
        for (const f of [...new Set(fuzzyForReview)]) line(`    ${f}`)
      }
      if (nSkipAmb) line(`  ⚠ ${nSkipAmb} 条参数因多候选未迁移，需人工指定后重跑`)
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
