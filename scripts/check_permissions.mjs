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

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const API_DIR = join(process.cwd(), 'server', 'api')

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

const ok = groups.unregistered.length === 0 && mismatches.length === 0
console.log(
  '\n' + (ok
    ? '✓ 自检通过：全部路由已纳入框架，且与现有手写守卫完全一致'
    : '✗ 自检未通过，请修正后再合入 main')
)
process.exit(ok ? 0 : 1)
