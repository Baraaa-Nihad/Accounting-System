import 'server-only'
import type { DbOrTx } from '../db'
import { Prisma } from '@/generated/prisma/client'
import { addDays, startOfDayInTimeZone, type DateOnly } from '@/lib/dates'

/**
 * عرض سجل النشاط ومحاولات الدخول (docs/09-audit-log.md §9.7) — قراءة فقط؛
 * لا توجد أي دالة تعديل أو حذف، والقاعدة ترفض ذلك بتريجر.
 */

/** العمليات الحساسة (§9.4) — تُميّز في العارض ويمكن عرضها وحدها. */
export const SENSITIVE_ACTIONS = [
  'cancel',
  'delete',
  'permissions',
  'password',
  'unlock',
  'sessions',
  'close_year',
  'reopen_year',
  'restore',
  'backup',
  'settings',
  'import',
  'reschedule',
  'forbidden',
  'login_failed',
  'status',
] as const

const SENSITIVE_UPDATES = ['Charge', 'Discount', 'Employee', 'Receipt', 'PaymentVoucher', 'PayrollItem', 'JournalEntry', 'Role', 'User']

export function isSensitive(l: { action: string; entityType: string }) {
  return (SENSITIVE_ACTIONS as readonly string[]).includes(l.action) || ((l.action === 'update' || l.action === 'create') && l.entityType === 'JournalEntry') || (l.action === 'update' && SENSITIVE_UPDATES.includes(l.entityType))
}

export interface AuditFilters {
  q?: string
  userId?: number
  action?: string
  entityType?: string
  entityId?: string
  from?: DateOnly
  to?: DateOnly
  sensitive?: boolean
  page?: number
  pageSize?: number
}

function auditWhere(f: AuditFilters, timeZone: string): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = []
  if (f.userId) and.push({ userId: f.userId })
  if (f.action) and.push({ action: f.action })
  if (f.entityType) and.push({ entityType: f.entityType })
  if (f.entityId) and.push({ entityId: f.entityId })
  if (f.from) and.push({ createdAt: { gte: startOfDayInTimeZone(f.from, timeZone) } })
  if (f.to) and.push({ createdAt: { lt: startOfDayInTimeZone(addDays(f.to, 1), timeZone) } })
  const q = f.q?.trim()
  if (q) {
    and.push({
      OR: [
        { summary: { contains: q, mode: 'insensitive' } },
        { entityLabel: { contains: q, mode: 'insensitive' } },
        { userName: { contains: q, mode: 'insensitive' } },
        { entityId: q },
        { ip: q },
      ],
    })
  }
  if (f.sensitive) {
    and.push({
      OR: [
        { action: { in: [...SENSITIVE_ACTIONS] } },
        { entityType: 'JournalEntry', action: { in: ['create', 'update'] } },
        { action: 'update', entityType: { in: SENSITIVE_UPDATES } },
      ],
    })
  }
  return and.length ? { AND: and } : {}
}

export async function listAuditLogs(client: DbOrTx, f: AuditFilters, timeZone: string) {
  const pageSize = f.pageSize ?? 50
  const where = auditWhere(f, timeZone)
  const total = await client.auditLog.count({ where })
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, f.page ?? 1), pages)
  const rows = await client.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
  return { rows, total, page, pages, pageSize }
}

/** كل الصفوف المطابقة (للتصدير) بحد أقصى. */
export async function exportAuditLogs(client: DbOrTx, f: AuditFilters, timeZone: string, limit = 20_000) {
  return client.auditLog.findMany({ where: auditWhere(f, timeZone), orderBy: { id: 'desc' }, take: limit })
}

/** خيارات الفلاتر من البيانات الفعلية. */
export async function auditFilterOptions(client: DbOrTx) {
  const [users, actions, entities] = await Promise.all([
    client.user.findMany({ select: { id: true, fullName: true, username: true }, orderBy: { fullName: 'asc' } }),
    client.$queryRaw<{ action: string }[]>`SELECT DISTINCT "action" FROM "audit_logs" ORDER BY 1`,
    client.$queryRaw<{ entityType: string }[]>`SELECT DISTINCT "entityType" AS "entityType" FROM "audit_logs" ORDER BY 1`,
  ])
  return { users, actions: actions.map((a) => a.action), entities: entities.map((e) => e.entityType) }
}

export interface LoginFilters {
  q?: string
  result?: 'ok' | 'fail'
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listLoginAttempts(client: DbOrTx, f: LoginFilters, timeZone: string) {
  const pageSize = f.pageSize ?? 50
  const and: Prisma.LoginAttemptWhereInput[] = []
  if (f.result) and.push({ success: f.result === 'ok' })
  if (f.from) and.push({ createdAt: { gte: startOfDayInTimeZone(f.from, timeZone) } })
  if (f.to) and.push({ createdAt: { lt: startOfDayInTimeZone(addDays(f.to, 1), timeZone) } })
  const q = f.q?.trim().toLowerCase()
  if (q) and.push({ OR: [{ username: { contains: q } }, { ip: q }] })
  const where = and.length ? { AND: and } : {}
  const total = await client.loginAttempt.count({ where })
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, f.page ?? 1), pages)
  const rows = await client.loginAttempt.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })
  return { rows, total, page, pages, pageSize }
}

/** ملخص أمني: الفاشلة آخر 24 ساعة، الحسابات المقفلة الآن، وأكثر الأجهزة فشلًا. */
export async function loginSecuritySummary(client: DbOrTx) {
  const since = new Date(Date.now() - 24 * 3600_000)
  const now = new Date()
  const [failed24, ok24, locked, topIps] = await Promise.all([
    client.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    client.loginAttempt.count({ where: { success: true, createdAt: { gte: since } } }),
    client.user.findMany({ where: { lockedUntil: { gt: now } }, select: { id: true, username: true, fullName: true, lockedUntil: true } }),
    client.$queryRaw<{ ip: string; failures: number; usernames: string }[]>`
      SELECT "ip", COUNT(*)::int AS failures, string_agg(DISTINCT "username", '، ') AS usernames
      FROM "login_attempts"
      WHERE "success" = false AND "createdAt" >= ${since} AND "ip" IS NOT NULL
      GROUP BY "ip" ORDER BY failures DESC LIMIT 5`,
  ])
  return { failed24, ok24, locked, topIps }
}
