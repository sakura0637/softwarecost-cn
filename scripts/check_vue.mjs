// 本地轻量校验 .vue 文件：Nuxt 构建在沙箱里会被安全删除机制拦下，
// 用它代替真构建，先把 SFC 语法 / <script setup> 编译 / 模板编译层面的错误拦在本机。
// 用法：node scripts/check_vue.mjs [目录...]（默认 pages components layouts）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (extname(p) === '.vue') out.push(p)
  }
  return out
}

const roots = process.argv.slice(2)
const dirs = roots.length ? roots : ['pages', 'components', 'layouts']
const files = dirs.flatMap((d) => walk(d))
let bad = 0

for (const file of files) {
  const id = file.replace(/\\/g, '/')
  const source = readFileSync(file, 'utf-8')
  let descriptor
  try {
    descriptor = parse(source, { filename: id }).descriptor
  } catch (e) {
    console.error(`✗ ${id}\n  解析失败: ${e.message}`)
    bad++
    continue
  }

  let scriptOk = true
  if (descriptor.script || descriptor.scriptSetup) {
    try {
      compileScript(descriptor, { id: 'x' })
    } catch (e) {
      console.error(`✗ ${id}\n  script: ${e.message}`)
      bad++
      scriptOk = false
    }
  }
  if (!scriptOk) continue

  if (descriptor.template) {
    try {
      const r = compileTemplate({
        id: 'x',
        filename: id,
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: descriptor.scriptSetup ? {} : undefined },
      })
      if (r.errors?.length) {
        console.error(`✗ ${id}\n  template: ${r.errors.map((x) => x.message || x).join('; ')}`)
        bad++
      }
    } catch (e) {
      console.error(`✗ ${id}\n  template: ${e.message}`)
      bad++
    }
  }
}

console.log(bad ? `\n发现 ${bad} 个文件有问题` : `✓ ${files.length} 个 .vue 文件校验通过`)
process.exit(bad ? 1 : 0)
