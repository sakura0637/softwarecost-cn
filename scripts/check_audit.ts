// 操作审计护栏自检（并入 npm run check）。
//
// 为什么需要它：审计链路的错误**几乎全是静默的** ——
//   写日志失败被 try-catch 吞掉、模块没登记中文名只会显示英文、撤销权限漏登记只会
//   「要么谁都能撤，要么谁都撤不了」。这些在运行期都不报错，只有自检能拦住。
//
// 断言项：
//   1. 代码里实际使用的 module 值，全部在 MODULE_LABELS 里有中文名
//   2. MODULE_LABELS 的每个模块都在 REVERT_PERM_BY_MODULE 里有撤销权限码（不留 fallback 漏洞）
//   3. 撤销权限码本身是**已注册的**权限码（模块存在且动作在 actions 里）
//   4. 大字段占位文字只有 config/audit.ts 一处定义（写方与判方必须同源）
//   5. operation_logs 的 entity_type / entity_id 列宽能装下真实表名与文本主键
//   6. admin-logs 模块已注册、路由前缀正确，且**没有**开放给普通用户
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MODULE_LABELS, REVERT_PERM_BY_MODULE, REVERT_PERM_FALLBACK, HEAVY_PLACEHOLDER, BATCH_ENTITY_ID,
  DEFAULT_OPERATION_MODULE, DEVICE_ENTITY_TYPES, NON_REVERTIBLE_ENTITIES, isRevertibleEntity
} from '../server/config/audit'
import { PERMISSION_MODULES, USER_PERMISSION_PATTERNS, resolveRoutePermission } from '../server/config/permissions'
import { DATA_TABLES } from '../server/config/dataTables'

const ROOT = (() => {
  // 定位项目根：打包产物在 node_modules/.cache 下，运行时 cwd 不稳定（沙箱里可能是盘根），
  // 故把「cwd」和「产物所在目录逐级上溯」两条路都试一遍。
  const seeds = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]
  for (const seed of seeds) {
    let cur = seed
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(cur, 'server', 'config', 'audit.ts'))) return cur
      const up = path.resolve(cur, '..')
      if (up === cur) break
      cur = up
    }
  }
  throw new Error('找不到项目根目录（server/config/audit.ts）')
})()
let pass = 0
const fails: string[] = []
function ok(msg: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fails.push(msg); console.log(`  ✗ ${msg}`) }
}

console.log('\n══ 操作审计护栏自检 ══')

// ── 收集源码里实际用到的 module 值 ──────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p)
  }
  return out
}
const files = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'pages'))]
// config/audit.ts 本身就是定义处，不算「使用方」
const AUDIT_CONF = path.join(ROOT, 'server', 'config', 'audit.ts')

const usedModules = new Set<string>([DEFAULT_OPERATION_MODULE])
for (const f of files) {
  if (path.resolve(f) === path.resolve(AUDIT_CONF)) continue
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/module:\s*'([^']+)'/g)) usedModules.add(m[1])
  for (const m of src.matchAll(/module\s*=\s*'([^']+)'/g)) usedModules.add(m[1])
}

ok(
  `代码里用到的 module 值都有中文名（${[...usedModules].sort().join(' / ')}）`,
  [...usedModules].every((m) => MODULE_LABELS[m])
)
ok(
  `MODULE_LABELS 没有「登记了但没有任何写入方」的死条目`,
  Object.keys(MODULE_LABELS).every((m) => usedModules.has(m))
)
ok(
  `MODULE_LABELS 的每个模块都登记了撤销权限码`,
  Object.keys(MODULE_LABELS).every((m) => REVERT_PERM_BY_MODULE[m])
)

// ── 撤销权限码必须是真实存在的权限码 ────────────────────────────
const badCodes: string[] = []
for (const code of [...Object.values(REVERT_PERM_BY_MODULE), REVERT_PERM_FALLBACK]) {
  const [mod, action] = code.split(':')
  const conf = PERMISSION_MODULES.find((m) => m.key === mod)
  if (!conf || !conf.actions.includes(action)) badCodes.push(code)
}
ok(`撤销权限码都是已注册权限（${[...new Set(Object.values(REVERT_PERM_BY_MODULE))].join(' / ')}）`, badCodes.length === 0)

// ── 大字段占位文字唯一来源 ──────────────────────────────────────
const placeholderDefs = files.filter((f) => fs.readFileSync(f, 'utf8').includes(`'${HEAVY_PLACEHOLDER}'`))
ok(
  `大字段占位文字只有一处字面量定义（${placeholderDefs.map((f) => path.relative(ROOT, f)).join(' / ')}）`,
  placeholderDefs.length === 1 && placeholderDefs[0].endsWith(path.join('config', 'audit.ts'))
)
ok(`批量操作标记值无冲突（'${BATCH_ENTITY_ID}' 不会与数字主键混淆）`, !/^\d+$/.test(BATCH_ENTITY_ID))

// ── operation_logs 列宽能装下真实数据 ───────────────────────────
const ddl = fs.readFileSync(path.join(ROOT, 'server', 'utils', 'db.ts'), 'utf8')
const etMatch = ddl.match(/entity_type\s+VARCHAR\((\d+)\)/)
const etLen = etMatch ? Number(etMatch[1]) : 0
const longestTable = [...DATA_TABLES.map((t) => t.key), 'station_device'].reduce((a, b) => (a.length >= b.length ? a : b))
ok(`entity_type 列宽 ${etLen} ≥ 最长实体名 ${longestTable}(${longestTable.length})`, etLen >= longestTable.length)
ok('entity_id 已放宽为 TEXT（standards 主键是文本）', /entity_id\s+TEXT\s+NOT NULL/.test(ddl))

// ── 撤销能力覆盖：记了日志的实体必须「可撤销」或「明确登记为不可撤销」 ──
const usedEntityTypes = new Set<string>(DEVICE_ENTITY_TYPES)
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/entityType:\s*'([^']+)'/g)) usedEntityTypes.add(m[1])
}
const orphans = [...usedEntityTypes].filter(
  (t) => !isRevertibleEntity(t) && !NON_REVERTIBLE_ENTITIES[t]
)
ok(
  `记了日志的实体都可撤销或已登记为不可撤销（${[...usedEntityTypes].sort().join(' / ')}）`,
  orphans.length === 0
)
ok(
  `数据维护全部表 + 设备三表都判定为可撤销`,
  [...DATA_TABLES.map((t) => t.key), ...DEVICE_ENTITY_TYPES].every((t) => isRevertibleEntity(t))
)
ok(
  `不可撤销实体不与数据维护表重名（${Object.keys(NON_REVERTIBLE_ENTITIES).join(' / ')}）`,
  Object.keys(NON_REVERTIBLE_ENTITIES).every((t) => !DATA_TABLES.some((d) => d.key === t))
)

// ── admin-logs 模块 ─────────────────────────────────────────────
const logsMod = PERMISSION_MODULES.find((m) => m.key === 'admin-logs')
ok('admin-logs 模块已注册且含 view/edit 动作', !!logsMod && logsMod.actions.includes('view') && logsMod.actions.includes('edit'))
ok('admin-logs 路由前缀已登记 /api/admin/logs', !!logsMod?.routes?.includes('/api/admin/logs'))
ok(
  'admin-logs 未开放给普通用户（审计含全站写操作，不能放开）',
  !USER_PERMISSION_PATTERNS.some((p) => p.startsWith('admin-logs'))
)
// 路由解析必须落到期望的权限码上，而不是靠「未登记 → 403」蒙对
const rList = resolveRoutePermission('GET', '/api/admin/logs')
const rRevert = resolveRoutePermission('POST', '/api/admin/logs/12/revert')
ok('GET /api/admin/logs → admin-logs:view', rList.kind === 'perm' && rList.code === 'admin-logs:view')
ok('POST /api/admin/logs/:id/revert → admin-logs:edit（未被默认映射成 create）', rRevert.kind === 'perm' && rRevert.code === 'admin-logs:edit')
const rDev = resolveRoutePermission('POST', '/api/admin/operation-logs/12/revert')
ok('设备页撤销口径未被改动（devices:edit）', rDev.kind === 'perm' && rDev.code === 'devices:edit')

console.log(
  fails.length === 0
    ? `\n✓ 通过：${pass} 项（模块中文名 / 撤销权限 / 占位同源 / 列宽 / 路由解析）\n`
    : `\n✗ 失败 ${fails.length} 项：\n${fails.map((f) => '  - ' + f).join('\n')}\n`
)
if (fails.length) process.exit(1)
