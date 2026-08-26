import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { getHeader } from 'h3'

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
