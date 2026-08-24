// 受保护路由中间件：未登录跳转到登录页
export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ['/', '/standards', '/industry', '/city', '/login', '/register']
  if (publicPaths.includes(to.path)) return

  const { token, user, me } = useAuth()
  if (!token.value) {
    return navigateTo('/login?redirect=' + encodeURIComponent(to.fullPath))
  }
  if (!user.value) {
    const u = await me()
    if (!u) return navigateTo('/login?redirect=' + encodeURIComponent(to.fullPath))
  }
})
