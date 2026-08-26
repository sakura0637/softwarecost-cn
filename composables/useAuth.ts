// 全局认证状态：token 持久化到 localStorage，封装带 Authorization 的请求
export const useAuth = () => {
  const token = useState<string | null>('auth_token', () =>
    process.client ? localStorage.getItem('token') : null
  )
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
    if (process.client) localStorage.setItem('token', t)
  }

  const logout = () => {
    token.value = null
    user.value = null
    roles.value = []
    permissions.value = []
    if (process.client) {
      localStorage.removeItem('token')
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

  // 是否拥有某权限码（如 'standards:edit'）
  const can = (code: string) => (permissions.value || []).includes(code)
  // 是否拥有某个角色编码
  const hasRole = (code: string) => (roles.value || []).includes(code)

  const isAdmin = computed(() => hasRole('admin') || (user.value?.role === 'admin'))

  return { token, user, roles, permissions, isAdmin, can, hasRole, setSession, logout, me, api }
}
