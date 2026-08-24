// 全局认证状态：token 持久化到 localStorage，封装带 Authorization 的请求
export const useAuth = () => {
  const token = useState<string | null>('auth_token', () =>
    process.client ? localStorage.getItem('token') : null
  )
  const user = useState<any>('auth_user', () => null)
  const router = process.client ? useRouter() : null

  const setSession = (t: string, u: any) => {
    token.value = t
    user.value = u
    if (process.client) localStorage.setItem('token', t)
  }

  const logout = () => {
    token.value = null
    user.value = null
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

  return { token, user, setSession, logout, me, api }
}
