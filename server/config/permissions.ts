// 系统权限目录（模块 + 按钮动作）。
// 从此处集中维护，db.ts bootstrap 会自动注册到 permissions 表并初始化角色授权。
//
// ════════════════════════════════════════════════════════════════
// 【本文件是整个权限体系的唯一事实源（SSOT）】
// 新增 / 变更功能时，改这一个地方就够：
//   1. 在 PERMISSION_MODULES 加一行：key / name / actions / routes
//   2. db.ts 启动时自动注册权限码、自动授予 admin 角色
//   3. server/middleware/permission.ts 按 routes + HTTP 方法自动守卫
//   4. 若需开放给普通用户，在 USER_PERMISSION_PATTERNS 加通配
//   5. 跑 `node scripts/check_permissions.mjs` 自检有无「未登记路由」
// ════════════════════════════════════════════════════════════════
export interface PermissionModule {
  key: string
  name: string
  actions: string[]
  /** 该模块管辖的 API 路径前缀；全局中间件据此 + HTTP 方法自动推导所需权限码 */
  routes?: string[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'standards', name: '造价标准库', actions: ['view', 'create', 'edit', 'delete'],
    routes: ['/api/standards'] },
  { key: 'devices', name: '设备价格库', actions: ['view', 'create', 'edit', 'delete'],
    routes: ['/api/admin/devices', '/api/admin/stations', '/api/admin/station-devices', '/api/admin/operation-logs'] },
  { key: 'industry', name: '行业基准数据分析', actions: ['view'] },
  { key: 'city', name: '省市计价数据分析', actions: ['view'] },
  { key: 'parameters', name: '参数设置', actions: ['view'] },
  { key: 'projects', name: '工作台', actions: ['view', 'create', 'edit', 'delete'],
    routes: ['/api/projects'] },
  { key: 'data', name: '数据维护', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin-users', name: '用户管理', actions: ['view', 'create', 'edit', 'delete'],
    routes: ['/api/admin/users'] },
  { key: 'admin-roles', name: '角色管理', actions: ['view', 'create', 'edit', 'delete'],
    routes: ['/api/admin/roles'] },
  { key: 'admin-permissions', name: '权限管理', actions: ['view', 'edit'],
    routes: ['/api/admin/permissions'] },
]

export const ACTION_NAMES: Record<string, string> = {
  view: '查看',
  create: '新增',
  edit: '编辑',
  delete: '删除',
}

// 系统内置角色：admin 拥有全部权限；user 拥有以下通配/精确匹配的权限
export const DEFAULT_ROLES = [
  { code: 'admin', name: '系统管理员', description: '拥有系统全部权限', is_system: true },
  { code: 'user', name: '普通用户', description: '默认注册用户', is_system: false },
]

// 普通用户默认拥有的权限匹配模式（支持通配符 *）。
// 例如 'standards:*' 表示 standards 模块下所有按钮权限；'devices:view' 表示仅查看。
// 新增功能时把需要开放给普通用户的权限加进来即可。
export const USER_PERMISSION_PATTERNS = [
  'standards:*',
  'devices:view',
  'industry:*',
  'city:*',
  'parameters:*',
  'projects:*',
]

// 简单通配匹配（code 如 'standards:view'，pattern 如 'standards:*' 或 'standards:view'）
export function matchesPermissionPattern(code: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(code)
  }
  return code === pattern
}

// ════════════════════════════════════════════════════════════════
// 路由 → 权限 解析规则（供 server/middleware/permission.ts 与自检脚本共用）
// 判定优先级：完全公开 → 只验登录 → 只读公开(GET) → 精确规则 → 模块前缀+方法 → 未登记
// ════════════════════════════════════════════════════════════════

/** 完全公开：任何方法都不校验（登录/注册必须匿名可访问） */
export const PUBLIC_ROUTES_ANY = [
  '/api/auth/login',
  '/api/auth/register',
]

/** 只读公开：GET 放行，写操作仍按模块权限校验 */
export const PUBLIC_GET_ROUTES = [
  '/api/standards',
  '/api/standards/:id/parameters',
  '/api/standards/:id/attachments',
  '/api/standards/:id/attachments/:fid',
  '/api/standards/attachments-summary',
  '/api/devices',
  '/api/devices/filters',
  '/api/devices/export',
  '/api/estimation-benchmarks',
  '/api/parameters',
  '/api/pricing-standards',
  '/api/provincial-pricing',
  '/api/city-rates',
]

/** 只需登录、不校验具体权限码（不属于任何业务模块，如取当前身份） */
export const AUTH_ONLY_ROUTES = [
  '/api/auth/me',
]

/**
 * 精确规则：优先于「模块前缀 + 方法映射」。
 * 用于 HTTP 方法语义与默认映射不符的接口（如 POST 实为修改、DELETE 实为修改等）。
 */
export const ROUTE_PERMISSION_RULES: Array<{ method: string; pattern: string; code: string; note?: string }> = [
  // —— 设备价格库：这几处的 POST/DELETE 语义是「修改」而非「新增/删除」
  { method: 'POST', pattern: '/api/admin/devices/import-seed', code: 'devices:edit', note: '种子导入视为修改' },
  { method: 'POST', pattern: '/api/admin/stations', code: 'devices:edit', note: '站点维护视为修改' },
  { method: 'POST', pattern: '/api/admin/station-devices', code: 'devices:edit', note: '子站设备维护视为修改' },
  { method: 'POST', pattern: '/api/admin/operation-logs/:id/revert', code: 'devices:edit', note: '撤销操作' },
  // —— 角色下的权限：路径在 roles 下，但归属「权限管理」模块
  { method: 'GET', pattern: '/api/admin/roles/:id/permissions', code: 'admin-permissions:view' },
  { method: 'PUT', pattern: '/api/admin/roles/:id/permissions', code: 'admin-permissions:edit' },
  // —— 标准参数：增删改一律视为「修改标准」
  { method: 'POST', pattern: '/api/standards/:id/parameters', code: 'standards:edit' },
  { method: 'DELETE', pattern: '/api/standards/:id/parameters/:pid', code: 'standards:edit' },
  // —— 标准附件：补漏，此前只有登录校验、无权限码校验
  { method: 'POST', pattern: '/api/standards/:id/attachments', code: 'standards:edit', note: '补漏：此前无权限校验' },
  { method: 'DELETE', pattern: '/api/standards/:id/attachments/:fid', code: 'standards:edit', note: '补漏：此前无权限校验' },
  // —— 工作台：上传/功能点维护视为修改项目，分析/测算为只读计算
  { method: 'PUT', pattern: '/api/projects/:id/function-points', code: 'projects:edit' },
  { method: 'POST', pattern: '/api/projects/:id/upload', code: 'projects:edit' },
  { method: 'POST', pattern: '/api/projects/:id/analyze', code: 'projects:view', note: '只读计算' },
  { method: 'POST', pattern: '/api/projects/:id/calculate', code: 'projects:view', note: '只读计算' },
]

/** HTTP 方法 → 动作 的默认映射（模块前缀匹配后套用） */
export const METHOD_ACTION: Record<string, string> = {
  GET: 'view',
  POST: 'create',
  PUT: 'edit',
  PATCH: 'edit',
  DELETE: 'delete',
}

export type RouteResolution =
  | { kind: 'public' }
  | { kind: 'auth-only' }
  | { kind: 'perm'; code: string }
  | { kind: 'unregistered' }

/** 路径段数相同的精确匹配，段值支持 :param 通配 */
function pathEquals(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean)
  const a = path.split('/').filter(Boolean)
  if (p.length !== a.length) return false
  return p.every((seg, i) => seg.startsWith(':') || seg === a[i])
}

function pathStartsWith(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(prefix + '/')
}

/** 按「最长前缀优先」匹配所属模块，避免 /api/admin/roles/:id/permissions 误判到 roles */
function matchModule(path: string): PermissionModule | null {
  let best: PermissionModule | null = null
  let bestLen = -1
  for (const m of PERMISSION_MODULES) {
    for (const r of m.routes || []) {
      if (pathStartsWith(r, path) && r.length > bestLen) {
        best = m
        bestLen = r.length
      }
    }
  }
  return best
}

/** 给定 HTTP 方法与请求路径，解析出该请求需要的权限判定 */
export function resolveRoutePermission(method: string, path: string): RouteResolution {
  const m = (method || 'GET').toUpperCase()
  const clean = (path || '').split('?')[0].replace(/\/+$/, '') || '/'

  if (PUBLIC_ROUTES_ANY.some((r) => pathEquals(r, clean))) return { kind: 'public' }
  if (AUTH_ONLY_ROUTES.some((r) => pathEquals(r, clean))) return { kind: 'auth-only' }
  if (m === 'GET' && PUBLIC_GET_ROUTES.some((r) => pathEquals(r, clean))) return { kind: 'public' }

  const rule = ROUTE_PERMISSION_RULES.find((r) => r.method === m && pathEquals(r.pattern, clean))
  if (rule) return { kind: 'perm', code: rule.code }

  const mod = matchModule(clean)
  if (mod) {
    const action = METHOD_ACTION[m]
    if (action && mod.actions.includes(action)) return { kind: 'perm', code: `${mod.key}:${action}` }
    return { kind: 'unregistered' }
  }

  return { kind: 'unregistered' }
}
