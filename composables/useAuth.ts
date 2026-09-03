// 全局认证状态：token 用 cookie 存储（SSR/CSR 均可读），避免刷新退出、
// 以及 useState 在 SSR 阶段把 token 初始化为 null 并写入 payload、客户端 hydrate
// 后不再回读 localStorage 导致的“受保护路由判定未登录、点不进工作台”问题。
export const useAuth = () => {
  // cookie 在服务器（请求头）与客户端（document.cookie）均可读，天然 SSR 安全
  const token = useCookie<string | null>('auth_token', {
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax',
    path: '/',
  })
  const user = useState<any>('auth_user', () => null)
  // 当前用户角色编码列表与权限码列表（来自 /api/auth/me）
  const roles = useState<string[]>('auth_roles', () => [])
  const permissions = useState<string[]>('auth_perms', () => [])
  const router = process.client ? useRouter() : null

  const setSession = (t: string, u: any) => {
    token.value = t
    user.value = u
    roles.value = u?.roles || []
    permissions.value = u?.permissions || []
  }

  const logout = () => {
    token.value = null
    user.value = null
    roles.value = []
    permissions.value = []
    if (process.client) {
      // 兼容旧版：清掉可能残留的 localStorage
      try { localStorage.removeItem('token') } catch { /* ignore */ }
      router?.push('/login')
    }
  }

  const me = async () => {
    if (!token.value) return null
    try {
      const res: any = await $fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.value}` }
      })
      user.value = res.user
      roles.value = res.user?.roles || []
      permissions.value = res.user?.permissions || []
      return res.user
    } catch {
      // 仅在确实拿不到用户信息时清登录态（如 token 过期/无效）
      logout()
      return null
    }
  }

  // 带鉴权的请求封装
  const api = async (url: string, options: any = {}) => {
    const headers: any = { ...(options.headers || {}) }
    if (token.value) headers.Authorization = `Bearer ${token.value}`
    return $fetch(url, { ...options, headers })
  }

  // 是否拥有某个角色编码
  const hasRole = (code: string) => (roles.value || []).includes(code)
  const isAdmin = computed(() => hasRole('admin') || (user.value?.role === 'admin'))

  // 是否拥有某权限码（如 'standards:edit'）
  // 管理员直通：与后端 requirePerm 的 isAdmin 短路保持一致，
  // 避免新权限码尚未写进 role_permissions 时，admin 被自己的前端 UI 挡在门外（菜单/按钮不显示）。
  const can = (code: string) => !!isAdmin.value || (permissions.value || []).includes(code)

  return { token, user, roles, permissions, isAdmin, can, hasRole, setSession, logout, me, api }
}
