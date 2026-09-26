import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { D } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import { prepareSearchQuery } from '@/lib/arabic'
import type { Row } from './types'

/** أدوات مشتركة لاستعلامات التقارير. */

export const sql = Prisma.sql
export const empty = Prisma.empty

export function where(conds: Prisma.Sql[]) {
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty
}

export function andAll(conds: Prisma.Sql[]) {
  return conds.length ? Prisma.join(conds, ' AND ') : Prisma.sql`TRUE`
}

export const dt = (d: DateOnly) => fromDateOnly(d)

export function dateRange(column: Prisma.Sql, from: DateOnly | null, to: DateOnly | null): Prisma.Sql[] {
  const out: Prisma.Sql[] = []
  if (from) out.push(Prisma.sql`${column} >= ${fromDateOnly(from)}`)
  if (to) out.push(Prisma.sql`${column} <= ${fromDateOnly(to)}`)
  return out
}

export function amountRange(expr: Prisma.Sql, min: string | null, max: string | null): Prisma.Sql[] {
  const out: Prisma.Sql[] = []
  if (min) out.push(Prisma.sql`${expr} >= ${min}::numeric`)
  if (max) out.push(Prisma.sql`${expr} <= ${max}::numeric`)
  return out
}

/** بحث نصي مطبّع على عمود searchText. */
export function searchLike(column: Prisma.Sql, q: string | null): Prisma.Sql[] {
  if (!q) return []
  const { text, digits } = prepareSearchQuery(q)
  if (!text) return []
  return [digits.length >= 3 && digits !== text ? Prisma.sql`(${column} LIKE ${`%${text}%`} OR ${column} LIKE ${`%${digits}%`})` : Prisma.sql`${column} LIKE ${`%${text}%`}`]
}

export const m = (v: unknown) => D(v === null || v === undefined ? 0 : String(v)).toString()
export const n = (v: unknown) => Number(v ?? 0)
export const d = (v: Date | null | undefined) => (v ? toDateOnly(v) : null)
export const pct = (part: unknown, whole: unknown) => {
  const w = D(whole === null || whole === undefined ? 0 : String(whole))
  return w.isZero() ? null : D(part === null || part === undefined ? 0 : String(part)).dividedBy(w).times(100).toDecimalPlaces(2).toNumber()
}

/** مجموع أعمدة المبالغ لصف الإجماليات. */
export function totalsOf(rows: Row[], keys: string[], label: { key: string; text: string }): Row {
  const t: Row = { [label.key]: label.text }
  for (const k of keys) t[k] = rows.reduce((acc, r) => acc.plus(D(r[k] === null || r[k] === undefined ? 0 : String(r[k]))), D(0)).toString()
  return t
}
