// 全局权限中间件：所有 /api/** 请求的统一收口点。
//
// 【为什么需要它】此前每个路由靠作者手写 requirePerm，漏写就裸奔
// （审计发现标准附件、工作台 6 个写接口全都没挂权限校验）。
// 有了本中间件，新增接口只要在 server/config/permissions.ts 的模块 routes 前缀下，
// 就自动被守卫覆盖；未登记的接口按「严格拒绝」直接 403，开发期即暴露。
//
// 判定规则全部来自 server/config/permissions.ts（唯一事实源），本文件不含任何硬编码权限码。
import { createError, getMethod } from 'h3'
import { getAuthUserWithPerms } from '../utils/auth'
import { resolveRoutePermission } from '../config/permissions'

export default defineEventHandler(async (event) => {
  // 取请求路径（兼容 h3 不同版本的取法）
  const raw: string =
    (event as any).path ||
    (event as any)?.node?.req?.url ||
    ''
  const path = (raw || '').split('?')[0]

  // 非 API 请求（页面、静态资源）不处理
  if (!path.startsWith('/api/')) return

  const method = getMethod(event)
  const verdict = resolveRoutePermission(method, path)

  // 完全公开：登录/注册
  if (verdict.kind === 'public') return

  // 其余一律需要登录
  const user = await getAuthUserWithPerms(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '未登录' })

  // 只验登录、不验权限码（如 /api/auth/me）
  if (verdict.kind === 'auth-only') return

  // 未纳入框架：严格拒绝，避免「新接口漏挂守卫」再次发生
  if (verdict.kind === 'unregistered') {
    console.warn(`[perm] 未登记接口被拦截：${method} ${path}`)
    throw createError({
      statusCode: 403,
      statusMessage: `该接口未纳入权限框架（${method} ${path}），请在 server/config/permissions.ts 登记`,
    })
  }

  // 管理员直通（与 requirePerm 保持一致；正常情况 bootstrap 也已授予 admin 全量权限）
  if (user.isAdmin) return

  if (!user.permissions.includes(verdict.code)) {
    throw createError({ statusCode: 403, statusMessage: '无权限执行该操作' })
  }
})
