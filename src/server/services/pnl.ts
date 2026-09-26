import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx } from '../db'
import { D } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'

/**
 * المصروفات والإيرادات حسب التصنيف من الأستاذ العام مباشرة (أساس الاستحقاق):
 * تشمل سندات الصرف والفواتير والاتفاقيات والرواتب، والذمم والخصومات والإيرادات الأخرى.
 */

export interface CategoryTotal {
  accountId: number
  code: string
  name: string
  parentId: number | null
  systemKey: string | null
  isActive: boolean
  description: string | null
  total: string
  count: number
}

function rangeSql(range: { from?: DateOnly | null; to?: DateOnly | null }) {
  const parts: Prisma.Sql[] = []
  if (range.from) parts.push(Prisma.sql`AND jl."date" >= ${fromDateOnly(range.from)}`)
  if (range.to) parts.push(Prisma.sql`AND jl."date" <= ${fromDateOnly(range.to)}`)
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty
}

/** إجمالي كل حساب فرعي من نوع معين في فترة (مصروف: مدين − دائن، إيراد: دائن − مدين). */
export async function categoryTotals(client: DbOrTx, type: 'EXPENSE' | 'REVENUE', range: { from?: DateOnly | null; to?: DateOnly | null }): Promise<CategoryTotal[]> {
  const sign = type === 'EXPENSE' ? Prisma.sql`jl."debit" - jl."credit"` : Prisma.sql`jl."credit" - jl."debit"`
  const rows = await client.$queryRaw<
    { id: number; code: string; name: string; parentId: number | null; systemKey: string | null; isActive: boolean; description: string | null; total: string; count: bigint }[]
  >`
    SELECT a."id", a."code", a."name", a."parentId", a."systemKey", a."isActive", a."description",
           COALESCE(SUM(${sign}), 0)::text AS total,
           COUNT(jl."id") AS count
    FROM "accounts" a
    LEFT JOIN "journal_lines" jl ON jl."accountId" = a."id" ${rangeSql(range)}
    WHERE a."type" = ${type}::"AccountType" AND a."isGroup" = false
    GROUP BY a."id"
    ORDER BY a."code" ASC`
  return rows.map((r) => ({
    accountId: Number(r.id),
    code: r.code,
    name: r.name,
    parentId: r.parentId,
    systemKey: r.systemKey,
    isActive: r.isActive,
    description: r.description,
    total: D(r.total).toString(),
    count: Number(r.count),
  }))
}

export interface CategoryLine {
  lineId: number
  date: DateOnly
  accountId: number
  accountName: string
  entryNumber: string
  sourceType: string
  sourceId: number | null
  description: string
  amount: string
}

/** حركات حسابات نوع معين (قائمة المصروفات/الإيرادات التفصيلية) مع الترقيم. */
export async function categoryLines(
  client: DbOrTx,
  f: { type: 'EXPENSE' | 'REVENUE'; accountId?: number; from?: DateOnly | null; to?: DateOnly | null; q?: string; hideReversed?: boolean; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 5000)
  const page = Math.max(f.page ?? 1, 1)
  const conds: Prisma.Sql[] = [Prisma.sql`a."type" = ${f.type}::"AccountType"`]
  if (f.accountId) conds.push(Prisma.sql`jl."accountId" = ${f.accountId}`)
  if (f.from) conds.push(Prisma.sql`jl."date" >= ${fromDateOnly(f.from)}`)
  if (f.to) conds.push(Prisma.sql`jl."date" <= ${fromDateOnly(f.to)}`)
  if (f.q) conds.push(Prisma.sql`(COALESCE(jl."description", je."description") ILIKE ${`%${f.q}%`} OR je."number" ILIKE ${`%${f.q}%`})`)
  if (f.hideReversed) conds.push(Prisma.sql`je."status" = 'POSTED' AND je."reversalOfId" IS NULL`)
  const where = Prisma.join(conds, ' AND ')
  const amount = f.type === 'EXPENSE' ? Prisma.sql`jl."debit" - jl."credit"` : Prisma.sql`jl."credit" - jl."debit"`
  const [rows, [agg]] = await Promise.all([
    client.$queryRaw<
      { lineId: number; date: Date; accountId: number; accountName: string; number: string; sourceType: string; sourceId: number | null; description: string; amount: string }[]
    >`
      SELECT jl."id" AS "lineId", jl."date", a."id" AS "accountId", a."name" AS "accountName", je."number", je."sourceType", je."sourceId",
             COALESCE(jl."description", je."description") AS description, (${amount})::text AS amount
      FROM "journal_lines" jl
      JOIN "journal_entries" je ON je."id" = jl."entryId"
      JOIN "accounts" a ON a."id" = jl."accountId"
      WHERE ${where}
      ORDER BY jl."date" DESC, jl."id" DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    client.$queryRaw<{ count: bigint; total: string }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(${amount}), 0)::text AS total
      FROM "journal_lines" jl
      JOIN "journal_entries" je ON je."id" = jl."entryId"
      JOIN "accounts" a ON a."id" = jl."accountId"
      WHERE ${where}`,
  ])
  const total = Number(agg.count)
  return {
    rows: rows.map(
      (r): CategoryLine => ({
        lineId: Number(r.lineId),
        date: toDateOnly(r.date),
        accountId: Number(r.accountId),
        accountName: r.accountName,
        entryNumber: r.number,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        description: r.description,
        amount: D(r.amount).toString(),
      }),
    ),
    total,
    sum: D(agg.total).toString(),
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  }
}
