import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { db } from '../db'

export const SESSION_COOKIE = 'sa_session'
const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null; secure: boolean }> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip'))?.trim() || null
  const userAgent = h.get('user-agent')?.slice(0, 300) ?? null
  const proto = h.get('x-forwarded-proto')
  const override = process.env.COOKIE_SECURE
  const secure = override === 'true' ? true : override === 'false' ? false : proto === 'https'
  return { ip, userAgent, secure }
}

export async function createSession(userId: number, hours: number) {
  const token = generateSessionToken()
  const meta = await requestMeta()
  const expiresAt = new Date(Date.now() + hours * 3600_000)
  await db.session.create({
    data: { id: hashSessionToken(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: meta.secure,
    sameSite: 'lax',
    path: '/',
  })
  return { token, expiresAt }
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

/** يتحقق من الجلسة ويمدد صلاحيتها (نافذة منزلقة) — يعيد null إذا كانت غير صالحة. */
export async function validateSession(token: string, sessionHours: number) {
  const id = hashSessionToken(token)
  const session = await db.session.findUnique({
    where: { id },
    include: { user: { include: { role: true } } },
  })
  if (!session) return null
  const now = Date.now()
  if (session.expiresAt.getTime() <= now || !session.user.isActive) {
    await db.session.deleteMany({ where: { id } })
    return null
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + sessionHours * 3600_000) },
    })
  }
  return session
}

export async function deleteSession(token: string) {
  await db.session.deleteMany({ where: { id: hashSessionToken(token) } })
}

export async function deleteUserSessions(userId: number, exceptSessionId?: string) {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } })
}
