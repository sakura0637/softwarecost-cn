// 生成 omData.ts 里 omQuotaItems 的「计算说明」（formula_text）。
//
// 背景：定额条目的推导式是给引擎算的英文变量写法（month_wage/176*fp_coef），
// 人看着像天书。这个脚本把 182 条推导式翻译成白话（如「月工资基数 ÷ 176工时 × 功能点系数」），
// 写进 formula_text 字段，供【数据维护 → 运维参数 → 定额单价库】的「计算说明」列展示。
//
// 用法：node scripts/gen_formula_text.cjs
// 特性：幂等 —— 已有 formula_text 的行跳过，不会重复插入；翻译规则只做字面替换，不猜语义，
//       所以生成结果一定与 formula 等价（真正参与计算的始终是 formula，formula_text 仅供阅读）。
const fs = require('fs')
const path = require('path')

const FILE = path.join(process.cwd(), 'server', 'seed', 'omData.ts')
let text = fs.readFileSync(FILE, 'utf8')

const startIdx = text.indexOf('export const omQuotaItems')
if (startIdx < 0) throw new Error('找不到 omQuotaItems')
const nextExport = text.indexOf('\nexport const ', startIdx + 10)
if (nextExport < 0) throw new Error('找不到 omQuotaItems 的结束位置')
const body = text.slice(startIdx, nextExport)

// ── 翻译规则 ──────────────────────────────────────────────
// 实测 182 条推导式共 45 种写法，只用到 3 个变量：
//   month_wage 月工资基数 / fp_coef 功能点系数 / wage_ratio 运维单价调整系数
function translate(f) {
  const src = String(f || '').trim()
  if (!src) return '固定值，不随后台参数联动'
  let s = src
  // 常量先补语义单位（必须在运算符全局替换之前做，否则 / 已被换掉就认不出来了）
  s = s.replace(/\/\s*12(?![0-9.])/g, ' ÷ 12个月 ')
  s = s.replace(/\*\s*12(?![0-9.])/g, ' × 12个月 ')
  s = s.replace(/\/\s*176(?![0-9.])/g, ' ÷ 176工时 ')
  // 变量 → 中文（先长后短，避免前缀误伤）
  s = s.replace(/\bwage_ratio\b/g, '运维单价调整系数')
  s = s.replace(/\bmonth_wage\b/g, '月工资基数')
  s = s.replace(/\bfp_coef\b/g, '功能点系数')
  s = s.replace(/\bmonths\b/g, '月数')
  // 剩余运算符
  s = s.replace(/\*/g, ' × ')
  s = s.replace(/\//g, ' ÷ ')
  s = s.replace(/\+/g, ' + ')
  s = s.replace(/(\d)\s*-\s*(\d)/g, '$1 - $2')
  // 收拾空格与括号
  s = s.replace(/\s+/g, ' ')
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
  return s.trim()
}

// ── 逐行插入（本文件是每行一条的紧凑写法，天然一一对应）──
const lines = body.split('\n')
let n = 0
let skipped = 0
const out = lines.map((line) => {
  if (!/formula_raw:\s*"/.test(line)) return line
  if (line.includes('formula_text:')) {
    skipped += 1
    return line
  }
  const fm = line.match(/formula:\s*"([^"]*)"/)
  n += 1
  return line.replace(/(formula_raw:\s*"[^"]*",)/, `$1 formula_text: "${translate(fm ? fm[1] : '')}",`)
})

fs.writeFileSync(FILE, text.slice(0, startIdx) + out.join('\n') + text.slice(nextExport), 'utf8')

const uniq = new Set(out.filter((l) => /formula_text:/.test(l)).map((l) => (l.match(/formula_text:\s*"([^"]*)"/) || [])[1]))
console.log(`✓ 已生成 ${n} 条计算说明${skipped ? `（跳过已有 ${skipped} 条）` : ''}，共 ${uniq.size} 种不同表述`)
