import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx } from '../db'
import { D } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'
import type Decimal from 'decimal.js'

/**
 * أرصدة الحسابات من الأستاذ العام مباشرة.
 * القيود الأصلية والعكسية كلاهما يُحتسب، لذلك لا حاجة لتصفية الحالة.
 */

export interface DebitCredit {
  debit: Decimal
  credit: Decimal
  /** مدين − دائن */
  net: Decimal
}

function dateFilter(from?: DateOnly, to?: DateOnly) {
  const parts: Prisma.Sql[] = []
  if (from) parts.push(Prisma.sql`AND jl."date" >= ${fromDateOnly(from)}`)
  if (to) parts.push(Prisma.sql`AND jl."date" <= ${fromDateOnly(to)}`)
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty
}

export async function accountTotals(
  client: DbOrTx,
  accountId: number,
  range?: { from?: DateOnly; to?: DateOnly },
): Promise<DebitCredit> {
  const rows = await client.$queryRaw<{ debit: string | null; credit: string | null }[]>`
    SELECT COALESCE(SUM(jl."debit"), 0)::text AS debit, COALESCE(SUM(jl."credit"), 0)::text AS credit
    FROM "journal_lines" jl
    WHERE jl."accountId" = ${accountId} ${dateFilter(range?.from, range?.to)}`
  const debit = D(rows[0]?.debit)
  const credit = D(rows[0]?.credit)
  return { debit, credit, net: debit.minus(credit) }
}

/** أرصدة عدة حسابات دفعة واحدة: Map(accountId → {debit, credit, net}) */
export async function accountsTotals(
  client: DbOrTx,
  accountIds: number[],
  range?: { from?: DateOnly; to?: DateOnly },
): Promise<Map<number, DebitCredit>> {
  const result = new Map<number, DebitCredit>()
  if (accountIds.length === 0) return result
  const rows = await client.$queryRaw<{ accountId: number; debit: string; credit: string }[]>`
    SELECT jl."accountId" AS "accountId",
           COALESCE(SUM(jl."debit"), 0)::text AS debit,
           COALESCE(SUM(jl."credit"), 0)::text AS credit
    FROM "journal_lines" jl
    WHERE jl."accountId" IN (${Prisma.join(accountIds)}) ${dateFilter(range?.from, range?.to)}
    GROUP BY jl."accountId"`
  for (const id of accountIds) result.set(id, { debit: D(0), credit: D(0), net: D(0) })
  for (const r of rows) {
    const debit = D(r.debit)
    const credit = D(r.credit)
    result.set(Number(r.accountId), { debit, credit, net: debit.minus(credit) })
  }
  return result
}

/** رصيد صندوق/بنك (مدين − دائن على حسابه). */
export async function cashAccountBalance(client: DbOrTx, cashAccountId: number, asOf?: DateOnly): Promise<Decimal> {
  const ca = await client.cashAccount.findUnique({ where: { id: cashAccountId }, select: { glAccountId: true } })
  if (!ca) return D(0)
  const totals = await accountTotals(client, ca.glAccountId, { to: asOf })
  return totals.net
}

/** رصيد طرف (طالب، موظف، مورد، مقاول، شريك) على حساب معين. */
export async function partyBalance(
  client: DbOrTx,
  accountId: number,
  party: { studentId?: number; employeeId?: number; supplierId?: number; contractorId?: number; partnerId?: number },
  range?: { from?: DateOnly; to?: DateOnly },
): Promise<DebitCredit> {
  const conds: Prisma.Sql[] = []
  if (party.studentId !== undefined) conds.push(Prisma.sql`AND jl."studentId" = ${party.studentId}`)
  if (party.employeeId !== undefined) conds.push(Prisma.sql`AND jl."employeeId" = ${party.employeeId}`)
  if (party.supplierId !== undefined) conds.push(Prisma.sql`AND jl."supplierId" = ${party.supplierId}`)
  if (party.contractorId !== undefined) conds.push(Prisma.sql`AND jl."contractorId" = ${party.contractorId}`)
  if (party.partnerId !== undefined) conds.push(Prisma.sql`AND jl."partnerId" = ${party.partnerId}`)
  const rows = await client.$queryRaw<{ debit: string; credit: string }[]>`
    SELECT COALESCE(SUM(jl."debit"), 0)::text AS debit, COALESCE(SUM(jl."credit"), 0)::text AS credit
    FROM "journal_lines" jl
    WHERE jl."accountId" = ${accountId} ${conds.length ? Prisma.join(conds, ' ') : Prisma.empty}
      ${dateFilter(range?.from, range?.to)}`
  const debit = D(rows[0]?.debit)
  const credit = D(rows[0]?.credit)
  return { debit, credit, net: debit.minus(credit) }
}
