import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { getHeader, createError } from 'h3'
import db from './db'

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-only-secret-change-me-please'
)

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10)
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash)
}

export async function signToken(sub: string, role = 'user'): Promise<string> {
  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

export async function verifyToken(token: string): Promise<{ sub?: string; role?: string }> {
  const { payload } = await jwtVerify(token, secret)
  return payload as { sub?: string; role?: string }
}

// 从 Authorization: Bearer <token> 取当前登录用户 id 与 role；未登录返回 null
export async function getAuthUser(event: any): Promise<{ id: number; role: string } | null> {
  const auth = getHeader(event, 'authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  try {
    const p = await verifyToken(m[1])
    if (!p.sub) return null
    return { id: Number(p.sub), role: (p.role as string) || 'user' }
  } catch {
    return null
  }
}

// 从 Authorization: Bearer <token> 取当前登录用户 id，未登录返回 null
export async function getUserId(event: any): Promise<number | null> {
  const auth = getHeader(event, 'authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  try {
    const p = await verifyToken(m[1])
    return p.sub ? Number(p.sub) : null
  } catch {
    return null
  }
}

// 计算某用户所拥有的角色与权限（多角色权限取并集）。纯函数，不依赖请求上下文
export async function getUserPerms(id: number): Promise<{ roles: string[]; permissions: string[]; isAdmin: boolean }> {
  const roles = ((await db.prepare('SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?').all(id)) as { code: string }[]).map(r => r.code)
  const permissions = ((await db.prepare(`
    SELECT DISTINCT p.code
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_code = p.code
    JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?
  `).all(id)) as { code: string }[]).map(p => p.code)
  const isAdmin = roles.includes('admin')
  return { roles, permissions, isAdmin }
}

// 取当前登录用户完整身份（含角色/权限并集）；未登录返回 null
export async function getAuthUserWithPerms(event: any): Promise<{ id: number; role: string; roles: string[]; permissions: string[]; isAdmin: boolean } | null> {
  const base = await getAuthUser(event)
  if (!base) return null
  const perms = await getUserPerms(base.id)
  return { id: base.id, role: base.role, ...perms }
}

// 权限守卫：未登录 → 401；无该权限码 → 403；通过则返回用户身份信息
export async function requirePerm(event: any, code: string): Promise<{ id: number; role: string; roles: string[]; permissions: string[]; isAdmin: boolean }> {
  const u = await getAuthUserWithPerms(event)
  if (!u) throw createError({ statusCode: 401, statusMessage: '未登录' })
  // 管理员直通：与全局权限中间件保持一致，并避免 role_permissions 记录不全
  // （如旧库迁移、新权限码尚未补齐）时 admin 被自己 403
  if (u.isAdmin) return u
  if (!u.permissions.includes(code)) throw createError({ statusCode: 403, statusMessage: '无权限执行该操作' })
  return u
}
