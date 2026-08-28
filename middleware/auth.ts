// 受保护路由中间件：未登录跳转到登录页。
// token 已改由 cookie 存储（SSR/CSR 均可读），故中间件两端都跑也安全：
// - 服务端直接读请求 cookie 判断，刷新受保护页不会再被弹回登录；
// - 仅校验 token 是否存在，不再调用 /api/auth/me（避免误清登录态）。
// 用户信息/权限由 plugins/auth.client.ts 在客户端初始化时拉取填充。
export default defineNuxtRouteMiddleware((to) => {
  const publicPaths = ['/', '/standards', '/industry', '/city', '/login', '/register']
  if (publicPaths.includes(to.path)) return

  const { token } = useAuth()
  if (!token.value) {
    return navigateTo('/login?redirect=' + encodeURIComponent(to.fullPath))
  }
})
