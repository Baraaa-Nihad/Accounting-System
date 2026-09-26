import 'server-only'
import type { DbOrTx } from './db'
import type { Ctx } from './context'

/**
 * سجل النشاط: يُكتب داخل نفس معاملة العملية (docs/09-audit-log.md).
 * لا توجد أي دالة للتعديل أو الحذف، والقاعدة تمنع ذلك بتريجر.
 */

const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'token', 'sessionId'])

/** تحويل أي كائن (Decimal، Date، BigInt) إلى JSON آمن مع حذف الحقول الحساسة. */
export function toAuditJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (depth > 6) return '[…]'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => toAuditJson(v, depth + 1))
  if (typeof value === 'object') {
    // Prisma Decimal / decimal.js
    const maybeDecimal = value as { toFixed?: () => string; d?: unknown; e?: unknown; s?: unknown }
    if (typeof maybeDecimal.toFixed === 'function' && 'd' in maybeDecimal && 'e' in maybeDecimal && 's' in maybeDecimal) {
      return (value as { toString(): string }).toString()
    }
    if (value instanceof Set) return Array.from(value).map((v) => toAuditJson(v, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue
      if (typeof v === 'function') continue
      out[k] = toAuditJson(v, depth + 1)
    }
    return out
  }
  return String(value)
}

export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | number | null
  entityLabel?: string | null
  summary?: string | null
  before?: unknown
  after?: unknown
}

export async function audit(client: DbOrTx, ctx: Ctx, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      userId: ctx.userId,
      userName: ctx.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
      entityLabel: entry.entityLabel ?? null,
      summary: entry.summary ?? null,
      before: entry.before === undefined ? undefined : (toAuditJson(entry.before) as object),
      after: entry.after === undefined ? undefined : (toAuditJson(entry.after) as object),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  })
}

/** الحقول التي تغيرت فقط (للعرض في نافذة المقارنة). */
export function diffObjects(before: unknown, after: unknown): { field: string; before: unknown; after: unknown }[] {
  const b = (toAuditJson(before) ?? {}) as Record<string, unknown>
  const a = (toAuditJson(after) ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const changes: { field: string; before: unknown; after: unknown }[] = []
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'createdAt') continue
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changes.push({ field: k, before: b[k], after: a[k] })
  }
  return changes
}
