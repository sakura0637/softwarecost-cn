// 客户端启动插件：若已有 token，则拉取用户角色/权限，使导航门禁与 can() 立即可用
export default defineNuxtPlugin(async () => {
  const { token, me } = useAuth()
  if (token.value) {
    await me()
  }
})
