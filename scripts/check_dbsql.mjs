#!/usr/bin/env node
/**
 * 静态校验 server/utils/db.ts 里的 SQL 是否引用了「表中不存在的列」。
 *
 * 为什么需要它：
 *   DDL 是幂等的 CREATE TABLE + ALTER TABLE ADD COLUMN IF NOT EXISTS，
 *   而种子/迁移里的 INSERT / UPDATE 是手写的列名清单。两边一旦不同步，
 *   查库时才报 `column "xxx" does not exist` —— 而这个错发生在 bootstrap() 里，
 *   会把 ready Promise 打成 rejected，**整站 500**，且本地无任何提示。
 *   2026-09-15 实际踩过两次（om_quota_items.formula 系列、om_rate_items.engine）。
 *
 * 做法：解析 CREATE TABLE 的列 + ALTER TABLE ADD COLUMN 的补列 → 得到每表列集；
 *       再提取 INSERT 列清单与 UPDATE ... SET 的赋值列 → 逐个比对，缺列即报错。
 * 只做静态文本分析，不连数据库、不依赖 Node 版本特性。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// 允许传路径（便于对临时副本做反向测试）：node scripts/check_dbsql.mjs <file>
const SRC = resolve(process.argv[2] || resolve(here, '..', 'server', 'utils', 'db.ts'))
const text = readFileSync(SRC, 'utf8')

/** 表名 → 列名集合 */
const tables = new Map()
/** 表名 → 定义处行号（报错时提示用） */
const tableLine = new Map()

const lineOf = (idx) => text.slice(0, idx).split('\n').length

// ── 1) CREATE TABLE ... ( ... ); ──
// 收尾的 `);` 独占一行（本文件既有风格），据此界定列定义块
const reCreate = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g
for (const m of text.matchAll(reCreate)) {
  const [, table, body] = m
  if (!tables.has(table)) {
    tables.set(table, new Set())
    tableLine.set(table, lineOf(m.index))
  }
  const cols = tables.get(table)
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('--')) continue
    // 跳过表级约束
    if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK|EXCLUDE)\b/i.test(line)) continue
    const id = line.match(/^"?(\w+)"?/)
    if (id) cols.add(id[1])
  }
}

// ── 2) ALTER TABLE x ADD COLUMN IF NOT EXISTS col ... ──
const reAlter = /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)/g
for (const m of text.matchAll(reAlter)) {
  const [, table, col] = m
  if (!tables.has(table)) {
    tables.set(table, new Set())
    tableLine.set(table, lineOf(m.index))
  }
  tables.get(table).add(col)
}

// ── 3) INSERT INTO x (a, b, c) ──
const problems = []
const reInsert = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)/g
for (const m of text.matchAll(reInsert)) {
  const [, table, colList] = m
  if (!tables.has(table)) continue // 非本文件建的表，跳过
  const known = tables.get(table)
  for (const c of colList.split(',')) {
    const col = c.trim().replace(/^"|"$/g, '')
    if (col && !known.has(col)) {
      problems.push({ kind: 'INSERT', table, col, line: lineOf(m.index) })
    }
  }
}

// ── 4) UPDATE x SET a = ..., b = ... ──
// SET 段以 WHERE 收尾（本文件风格），其中不含顶层逗号以外的干扰
const reUpdate = /UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)\s+WHERE\b/g
for (const m of text.matchAll(reUpdate)) {
  const [, table, setBody] = m
  if (!tables.has(table)) continue
  const known = tables.get(table)
  for (const part of setBody.split(',')) {
    const a = part.match(/^\s*"?(\w+)"?\s*=/)
    if (!a) continue
    if (!known.has(a[1])) {
      problems.push({ kind: 'UPDATE', table, col: a[1], line: lineOf(m.index) })
    }
  }
}

// ── 输出 ──
const totalCols = [...tables.values()].reduce((n, s) => n + s.size, 0)
console.log(`\n━━━━ 数据库 SQL 列名自检 ━━━━`)
console.log(`解析 server/utils/db.ts：${tables.size} 张表 / ${totalCols} 个列定义`)

if (problems.length) {
  console.error(`\n✗ 发现 ${problems.length} 处「SQL 引用了不存在的列」（会导致 bootstrap 抛错、整站 500）：\n`)
  for (const p of problems) {
    console.error(`  ${p.kind}  ${p.table}.${p.col}   ← db.ts:${p.line}`)
  }
  const groups = [...new Set(problems.map((p) => p.table))]
  for (const t of groups) {
    console.error(`\n  表 ${t} 现有列：${[...tables.get(t)].join(', ')}`)
    console.error(`  （定义见 db.ts:${tableLine.get(t)}，补列请用 ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ...）`)
  }
  console.error('')
  process.exit(1)
}

console.log('✓ 通过：所有 INSERT / UPDATE 引用的列都在表定义中\n')
