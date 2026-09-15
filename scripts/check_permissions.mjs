#!/usr/bin/env node
// 权限框架自检（只读，不连库、不改任何数据）
//
// 作用：扫描 server/api 下全部路由文件，逐个用 resolveRoutePermission 判定，
// 报告两类问题：
//   1. 未登记路由 —— 上线后会被全局中间件 403（防止新接口漏挂守卫）
//   2. 判定不一致 —— 框架算出的权限码 ≠ 路由内手写的 requirePerm（防止改坏现有行为）
//
// 用法：node scripts/check_permissions.mjs
// 退出码：0 = 通过；1 = 有问题

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const API_DIR = join(process.cwd(), 'server', 'api')
// 前端页面目录（可用 PAGES_DIR 覆盖，便于对合成样例做验证）
const PAGES_DIR = process.env.PAGES_DIR || join(process.cwd(), 'pages')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** server/api/standards/[id]/parameters.get.ts → { method:'GET', path:'/api/standards/:id/parameters' } */
function fileToRoute(absPath) {
  const rel = relative(API_DIR, absPath).replace(/\\/g, '/')
  const noExt = rel.replace(/\.ts$/, '')
  const dot = noExt.lastIndexOf('.')
  if (dot < 0) return null
  const method = noExt.slice(dot + 1).toUpperCase()
  const segs = noExt.slice(0, dot).split('/').filter(Boolean)
  if (segs.length && segs[segs.length - 1] === 'index') segs.pop()
  const path = '/api' + (segs.length ? '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/') : '')
  return { method, path, file: rel }
}

/** 脚本是 .mjs，无法直接 import .ts，先用 esbuild 转译配置再动态导入 */
async function loadConfig() {
  const src = readFileSync(join(process.cwd(), 'server', 'config', 'permissions.ts'), 'utf-8')
  const out = esbuild.transformSync(src, { loader: 'ts', format: 'esm' })
  const tmp = join(tmpdir(), `perm-config-${Date.now()}.mjs`)
  writeFileSync(tmp, out.code)
  return import(pathToFileURL(tmp).href)
}

const { resolveRoutePermission } = await loadConfig()

const routes = walk(API_DIR)
  .map(fileToRoute)
  .filter(Boolean)
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

const groups = { public: [], 'auth-only': [], perm: [], unregistered: [] }
const mismatches = []

for (const r of routes) {
  const v = resolveRoutePermission(r.method, r.path)
  groups[v.kind].push({ ...r, code: v.code })

  const src = readFileSync(join(API_DIR, r.file), 'utf-8')
  const m = src.match(/requirePerm\(\s*event\s*,\s*'([^']+)'\s*\)/)
  const handwritten = m ? m[1] : null

  if (v.kind === 'perm' && handwritten && handwritten !== v.code) {
    mismatches.push({ ...r, code: v.code, handwritten })
  }
  if (v.kind === 'public' && handwritten) {
    mismatches.push({
      ...r,
      code: '(公开)',
      handwritten,
      note: '框架判定为公开，但路由内手写 requirePerm 会拒绝匿名访问',
    })
  }
}

console.log('════════ 权限框架自检 ════════')
console.log(`扫描到 ${routes.length} 个 API 路由\n`)
console.log(`  完全公开          ${String(groups.public.length).padStart(3)}`)
console.log(`  仅验登录          ${String(groups['auth-only'].length).padStart(3)}`)
console.log(`  需权限码          ${String(groups.perm.length).padStart(3)}`)
console.log(`  未登记(将被 403)  ${String(groups.unregistered.length).padStart(3)}`)

if (groups.unregistered.length) {
  console.log('\n✗ 未纳入权限框架（上线后会被中间件 403）：')
  for (const r of groups.unregistered) {
    console.log(`    ${r.method.padEnd(6)} ${r.path}`)
    console.log(`           ← ${r.file}`)
  }
}

if (mismatches.length) {
  console.log('\n⚠ 框架判定与路由内手写 requirePerm 不一致：')
  for (const m of mismatches) {
    console.log(`    ${m.method.padEnd(6)} ${m.path}`)
    console.log(`           框架=${m.code}   手写=${m.handwritten}`)
    if (m.note) console.log(`           ${m.note}`)
  }
}

// ── 前端裸 $fetch 调用受保护接口自检 ──────────────────────────
// 背景：服务端只认 Authorization: Bearer 头（server/utils/auth.ts 不读 cookie），
// 前端访问非公开接口必须用 useAuth() 的 api() 包装来带上该头。
// 用裸 $fetch 打受保护接口 → 401「未登录」（界面明明已登录），2026-09-15 运维测算页就这么挂过。
// 公开只读接口（PUBLIC_GET_ROUTES）用裸 $fetch 是正常的，不报。
function walkVue(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkVue(p))
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
}

/** `/api/om/params${q}` → `/api/om/params`；`/api/standards/${id}/x` → `/api/standards/:x/x` */
function normalizeUrl(lit) {
  const noQuery = lit.split('?')[0]
  return noQuery.replace(/\$\{[^}]*\}/g, ':x').replace(/\/+$/, '')
}

/**
 * 从 `$fetch(` 的左括号开始做括号配对（跳过字符串字面量），
 * 返回本次调用的实参文本。只在实参里找 method:，
 * 避免把「相邻的下一次调用」的 method 误安到本次头上。
 */
function argSpan(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === quote) break
        i++
      }
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
  }
  return src.slice(openIdx + 1, openIdx + 400)
}

const nakedFetch = []
for (const abs of walkVue(PAGES_DIR)) {
  const src = readFileSync(abs, 'utf-8')
  const re = /\$fetch\(\s*([`'"])([\s\S]*?)\1/g
  for (const m of src.matchAll(re)) {
    const literal = m[2]
    if (!literal.startsWith('/api')) continue
    const openIdx = src.indexOf('(', m.index)
    const args = openIdx >= 0 ? argSpan(src, openIdx) : ''
    const mm = args.match(/method:\s*['"](\w+)['"]/)
    const method = (mm ? mm[1] : 'GET').toUpperCase()
    const path = normalizeUrl(literal)
    const v = resolveRoutePermission(method, path)
    if (v.kind === 'perm' || v.kind === 'auth-only') {
      nakedFetch.push({
        file: relative(process.cwd(), abs).replace(/\\/g, '/'),
        method,
        path,
        code: v.code || '(需登录)',
      })
    }
  }
}

if (nakedFetch.length) {
  console.log('\n✗ 前端用裸 $fetch 调用了需要鉴权的接口（会 401/403，须改用 useAuth().api()）：')
  for (const f of nakedFetch) {
    console.log(`    ${f.method.padEnd(6)} ${f.path}   → ${f.code}`)
    console.log(`           ← ${f.file}`)
  }
}

const ok = groups.unregistered.length === 0 && mismatches.length === 0 && nakedFetch.length === 0
console.log(
  '\n' + (ok
    ? '✓ 自检通过：全部路由已纳入框架，手写守卫一致，前端无裸 fetch 打受保护接口'
    : '✗ 自检未通过，请修正后再合入 main')
)
process.exit(ok ? 0 : 1)
