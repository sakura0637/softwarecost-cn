// 系统权限目录（模块 + 按钮动作）。
// 从此处集中维护，db.ts bootstrap 会自动注册到 permissions 表并初始化角色授权。
// 新增功能时，只需在此数组里加一项，并给相关角色分配权限码即可。
export interface PermissionModule {
  key: string
  name: string
  actions: string[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'standards', name: '造价标准库', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'devices', name: '设备价格库', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'industry', name: '行业基准数据分析', actions: ['view'] },
  { key: 'city', name: '省市计价数据分析', actions: ['view'] },
  { key: 'parameters', name: '参数设置', actions: ['view'] },
  { key: 'projects', name: '工作台', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin-users', name: '用户管理', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin-roles', name: '角色管理', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin-permissions', name: '权限管理', actions: ['view', 'edit'] },
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
