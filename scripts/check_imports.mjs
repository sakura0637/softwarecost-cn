// 跨模块具名导出自检：捕捉「import { X } from './y' 但 y 没有导出 X」这类错误。
// 背景：esbuild/tsc 只查单文件语法，查不出跨模块导出缺失；
//       这类问题只有在 Nuxt/nitro 真实构建时才会以 RollupError: MISSING_EXPORT 暴露，
//       而服务器一次构建要 1~2 分钟，逐个报错修等于反复烧构建。
// 用法：node scripts/check_imports.mjs [目录，默认 server]
// 退出码：0 = 全部通过；1 = 存在缺失（并打印明细）

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ALIASES = {
  '~': ROOT,
  '@': ROOT,
  '~~': ROOT,
  '@@': ROOT,
}

const EXTS = ['', '.ts', '.mts', '.js', '.mjs', '.vue', '/index.ts', '/index.mjs']

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.output' || e.name === '.nuxt' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|mts|js|mjs|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

// 解析 import 子句（支持 `import d, { a, b as c } from` 与多行写法）
function parseClause(clause) {
  const named = []
  let hasDefault = false
  let hasNamespace = false
  // 去掉 `import type { ... }` / `import { type X }` 中的 type 关键字（纯类型导入不参与运行时导出检查）
  const typeOnly = /^type\b/.test(clause.trim())
  clause = clause.replace(/^type\b/, '').trim()
  const braceStart = clause.indexOf('{')
  let head = clause
  if (braceStart >= 0) {
    const braceEnd = clause.indexOf('}', braceStart)
    const inside = clause.slice(braceStart + 1, braceEnd === -1 ? undefined : braceEnd)
    for (const raw of inside.split(',')) {
      const t = raw.trim().replace(/^type\s+/, '')
      if (!t) continue
      named.push(t.split(/\s+as\s+/)[0].trim())
    }
    head = clause.slice(0, braceStart) + (braceEnd === -1 ? '' : clause.slice(braceEnd + 1))
  }
  for (const raw of head.split(',')) {
    const t = raw.trim()
    if (!t) continue
    if (t.startsWith('*')) hasNamespace = true
    else hasDefault = true
  }
  return { named, hasDefault: hasDefault && !typeOnly, hasNamespace, typeOnly }
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g

// 收集一个文件的导出符号
function collectExports(file) {
  const src = fs.readFileSync(file, 'utf8')
  const names = new Set()
  let hasDefault = false
  let reExportAll = false
  const add = (n) => n && names.add(n)

  for (const m of src.matchAll(/export\s+(?:declare\s+)?(async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g)) add(m[2])
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) add(m[1])
  for (const m of src.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g)) add(m[1])
  for (const m of src.matchAll(/export\s+(?:interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) add(m[1])
  // export { a, b as c }（含 `from './x'` 的转发）
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g)) {
    for (const raw of m[1].split(',')) {
      const t = raw.trim()
      if (!t) continue
      const parts = t.split(/\s+as\s+/)
      add((parts[1] || parts[0]).trim())
    }
  }
  if (/export\s+default/.test(src)) hasDefault = true
  if (/export\s+\*\s+from/.test(src)) reExportAll = true
  return { names, hasDefault, reExportAll }
}

function resolveTarget(spec, fromFile) {
  let base
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else {
    const hit = Object.keys(ALIASES).find((k) => spec === k || spec.startsWith(k + '/'))
    if (!hit) return null // 裸包名（h3/xlsx/pg…）交给打包器，不检查
    base = path.join(ALIASES[hit], spec.slice(hit.length))
  }
  for (const ext of EXTS) {
    const p = base + ext
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
  }
  return null
}

const target = process.argv[2] || 'server'
const files = walk(path.resolve(ROOT, target))
const cache = new Map()
function exportsOf(file) {
  if (!cache.has(file)) cache.set(file, collectExports(file))
  return cache.get(file)
}

const problems = []
let checkedFiles = 0
let checkedImports = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  let sawImport = false
  for (const m of src.matchAll(IMPORT_RE)) {
    sawImport = true
    const spec = m[2]
    const { named, hasDefault, hasNamespace } = parseClause(m[1])
    const targetFile = resolveTarget(spec, file)
    if (!targetFile) {
      if (spec.startsWith('.')) problems.push({ rel, spec, kind: '文件不存在', names: [] })
      continue // 裸包由打包器解析
    }
    checkedImports++
    const exp = exportsOf(targetFile)
    const missing = named.filter((n) => !exp.names.has(n) && !exp.reExportAll)
    if (missing.length) problems.push({ rel, spec, kind: '具名导出缺失', names: missing })
    if (hasDefault && !exp.hasDefault && !exp.reExportAll) {
      problems.push({ rel, spec, kind: '默认导出缺失', names: ['default'] })
    }
    void hasNamespace
  }
  if (sawImport) checkedFiles++
}

console.log('════════ 跨模块导入自检 ════════')
console.log(`扫描 ${files.length} 个文件，其中 ${checkedFiles} 个含相对导入，共校验 ${checkedImports} 条相对导入\n`)
if (!problems.length) {
  console.log('✓ 全部通过：没有「导入了不存在的导出」的问题')
  process.exit(0)
}
for (const p of problems) {
  console.log(`✗ ${p.kind}  ${p.rel}`)
  console.log(`    → from '${p.spec}'  缺失：${p.names.join(', ')}`)
}
console.log(`\n共 ${problems.length} 处问题`)
process.exit(1)
