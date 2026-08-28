// 轻量语法校验：不跑完整构建，直接对指定 .ts / .vue 做 esbuild + Vue SFC 编译检查。
// 用途：本地完整构建被沙箱 safe-delete 守卫拦住时，用它快速确认改动文件没有语法/模板错误。
// 用法：node scripts/check_syntax.mjs [文件...]（不带参数则检查内置默认清单）

import * as esbuild from 'esbuild'
import * as sfc from '@vue/compiler-sfc'
import fs from 'node:fs'

const DEFAULT_FILES = [
  'server/seed/estimationData.ts',
  'server/utils/db.ts',
  'server/utils/pricingStandards.ts',
  'server/utils/pricing.ts',
  'server/api/pricing-standards.get.ts',
  'server/api/projects/[id]/calculate.post.ts',
  'pages/projects/[id].vue',
]

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES
let fail = 0

const show = (e) =>
  (e.errors || []).map((x) => `     ${x.text}${x.location ? ` (${x.location.line}:${x.location.column})` : ''}`).join('\n') ||
  `     ${e.message}`

for (const f of files) {
  if (!fs.existsSync(f)) {
    fail++
    console.log(`FAIL ${f} —— 文件不存在`)
    continue
  }
  const src = fs.readFileSync(f, 'utf8')

  if (f.endsWith('.vue')) {
    const { descriptor, errors } = sfc.parse(src, { filename: f })
    if (errors.length) {
      fail++
      console.log(`FAIL ${f} (SFC 解析)`)
      errors.forEach((e) => console.log(`     ${e.message}`))
      continue
    }
    let ok = true
    const blk = descriptor.scriptSetup || descriptor.script
    if (blk) {
      try {
        await esbuild.transform(blk.content, { loader: 'ts', format: 'esm' })
      } catch (e) {
        ok = false
        fail++
        console.log(`FAIL ${f} (script)`)
        console.log(show(e))
      }
    }
    try {
      sfc.compileTemplate({ source: descriptor.template?.content || '', filename: f, id: f })
    } catch (e) {
      ok = false
      fail++
      console.log(`FAIL ${f} (template)`)
      console.log(`     ${e.message}`)
    }
    if (ok) console.log(`OK   ${f}`)
    continue
  }

  try {
    await esbuild.transform(src, { loader: 'ts', format: 'esm' })
    console.log(`OK   ${f}`)
  } catch (e) {
    fail++
    console.log(`FAIL ${f}`)
    console.log(show(e))
  }
}

console.log(fail ? `\n✗ ${fail} 个文件有问题` : '\n✓ 全部通过')
process.exit(fail ? 1 : 0)
