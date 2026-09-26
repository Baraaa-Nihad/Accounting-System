import 'server-only'
import { db } from '../db'
import { getSetting } from '../settings'
import { audit } from '../audit'
import { getDummyHash, hashPassword, passwordProblem, verifyPassword } from './password'
import { createSession, deleteSession, deleteUserSessions, readSessionToken, clearSessionCookie, requestMeta } from './session'
import { BusinessError } from '../errors'

const GENERIC_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة'
const IP_WINDOW_MINUTES = 15
const IP_MAX_FAILURES = 30

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

async function recordAttempt(data: { username: string; userId?: number | null; success: boolean; reason?: string }) {
  const meta = await requestMeta()
  await db.loginAttempt.create({
    data: { ...data, username: data.username.slice(0, 100), ip: meta.ip, userAgent: meta.userAgent },
  })
}

/** تسجيل الدخول مع القفل بعد المحاولات الفاشلة وتسجيل كل محاولة. */
export async function login(usernameInput: string, password: string): Promise<{ ok: true; mustChangePassword: boolean } | { ok: false; error: string }> {
  const username = normalizeUsername(usernameInput)
  const security = await getSetting('security')
  const meta = await requestMeta()

  if (meta.ip) {
    const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000)
    const failures = await db.loginAttempt.count({ where: { ip: meta.ip, success: false, createdAt: { gte: since } } })
    if (failures >= IP_MAX_FAILURES) {
      await recordAttempt({ username, success: false, reason: 'ip_throttled' })
      return { ok: false, error: 'محاولات كثيرة من هذا الجهاز. يرجى المحاولة بعد 15 دقيقة.' }
    }
  }

  const user = await db.user.findUnique({ where: { username } })
  if (!user) {
    await verifyPassword(password, await getDummyHash())
    await recordAttempt({ username, success: false, reason: 'unknown_user' })
    return { ok: false, error: GENERIC_ERROR }
  }

  const now = new Date()
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000)
    await recordAttempt({ username, userId: user.id, success: false, reason: 'locked' })
    return { ok: false, error: `الحساب مقفل مؤقتًا بسبب محاولات دخول فاشلة متكررة. حاول بعد ${minutes} دقيقة أو تواصل مع مدير النظام.` }
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    const failed = user.failedLoginCount + 1
    const lock = failed >= security.maxFailedAttempts
    await db.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + security.lockMinutes * 60_000) }
        : { failedLoginCount: failed },
    })
    await recordAttempt({ username, userId: user.id, success: false, reason: lock ? 'bad_password_locked' : 'bad_password' })
    if (lock) {
      await audit(db, { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: new Set() }, {
        action: 'login_failed',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.username,
        summary: `قفل الحساب ${user.username} لمدة ${security.lockMinutes} دقيقة بعد ${security.maxFailedAttempts} محاولات فاشلة`,
      })
      return { ok: false, error: `تم قفل الحساب لمدة ${security.lockMinutes} دقيقة بسبب تكرار كلمة المرور الخاطئة.` }
    }
    const remaining = security.maxFailedAttempts - failed
    return { ok: false, error: remaining <= 2 ? `${GENERIC_ERROR}. تبقى ${remaining} محاولة قبل قفل الحساب.` : GENERIC_ERROR }
  }

  if (!user.isActive) {
    await recordAttempt({ username, userId: user.id, success: false, reason: 'disabled' })
    return { ok: false, error: 'هذا الحساب معطّل. تواصل مع مدير النظام.' }
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: meta.ip },
  })
  await createSession(user.id, security.sessionHours)
  await recordAttempt({ username, userId: user.id, success: true })
  await audit(db, { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: new Set() }, {
    action: 'login',
    entityType: 'User',
    entityId: user.id,
    entityLabel: user.username,
    summary: `تسجيل دخول ${user.fullName}`,
  })
  return { ok: true, mustChangePassword: user.mustChangePassword }
}

export async function logout(): Promise<void> {
  const token = await readSessionToken()
  if (token) {
    const { hashSessionToken } = await import('./session')
    const session = await db.session.findUnique({ where: { id: hashSessionToken(token) }, include: { user: true } })
    if (session) {
      const meta = await requestMeta()
      await audit(db, { userId: session.userId, userName: session.user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: new Set() }, {
        action: 'logout',
        entityType: 'User',
        entityId: session.userId,
        entityLabel: session.user.username,
        summary: `تسجيل خروج ${session.user.fullName}`,
      })
    }
    await deleteSession(token)
  }
  await clearSessionCookie()
}

export async function changeOwnPassword(userId: number, currentSessionId: string, current: string, next: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  if (!(await verifyPassword(current, user.passwordHash))) throw new BusinessError('كلمة المرور الحالية غير صحيحة', { current: 'كلمة المرور الحالية غير صحيحة' })
  const problem = passwordProblem(next)
  if (problem) throw new BusinessError(problem, { next: problem })
  if (current === next) throw new BusinessError('اختر كلمة مرور مختلفة عن الحالية', { next: 'اختر كلمة مرور مختلفة عن الحالية' })
  const meta = await requestMeta()
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false },
    })
    await audit(tx, { userId, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: new Set() }, {
      action: 'password',
      entityType: 'User',
      entityId: userId,
      entityLabel: user.username,
      summary: `تغيير كلمة المرور للمستخدم ${user.username}`,
    })
  })
  await deleteUserSessions(userId, currentSessionId)
}
