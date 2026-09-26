import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx } from '../db'
import { D } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'

/**
 * كشف الحساب: أطراف القيود مرتبة زمنيًا مع الرصيد التراكمي.
 * يُستخدم لكشف حساب الطالب والموظف والمورد والمقاول ودفتر الأستاذ لأي حساب.
 */

export interface StatementRow {
  lineId: number
  date: DateOnly
  entryId: number
  entryNumber: string
  sourceType: string
  sourceId: number | null
  description: string
  debit: string
  credit: string
  balance: string
  reversed: boolean
  isReversal: boolean
}

export interface StatementFilter {
  accountIds: number[]
  studentId?: number
  employeeId?: number
  supplierId?: number
  contractorId?: number
  partnerId?: number
  from?: DateOnly | null
  to?: DateOnly | null
  /** إخفاء الحركات الملغاة وقيودها العكسية */
  hideReversed?: boolean
}

function partyConds(f: StatementFilter): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`jl."accountId" IN (${Prisma.join(f.accountIds)})`]
  if (f.studentId !== undefined) c.push(Prisma.sql`jl."studentId" = ${f.studentId}`)
  if (f.employeeId !== undefined) c.push(Prisma.sql`jl."employeeId" = ${f.employeeId}`)
  if (f.supplierId !== undefined) c.push(Prisma.sql`jl."supplierId" = ${f.supplierId}`)
  if (f.contractorId !== undefined) c.push(Prisma.sql`jl."contractorId" = ${f.contractorId}`)
  if (f.partnerId !== undefined) c.push(Prisma.sql`jl."partnerId" = ${f.partnerId}`)
  return c
}

/**
 * @param sign 1 للحسابات مدينة الطبيعة (الرصيد = مدين − دائن)، -1 للدائنة (دائن − مدين)
 */
export async function statement(client: DbOrTx, f: StatementFilter, sign: 1 | -1 = 1) {
  if (f.accountIds.length === 0) return { opening: '0', rows: [] as StatementRow[], closing: '0', totalDebit: '0', totalCredit: '0' }
  const conds = partyConds(f)
  const hide = f.hideReversed
    ? Prisma.sql`AND je."status" = 'POSTED' AND je."reversalOfId" IS NULL`
    : Prisma.empty

  let opening = D(0)
  if (f.from) {
    const [o] = await client.$queryRaw<{ net: string }[]>`
      SELECT COALESCE(SUM(jl."debit" - jl."credit"), 0)::text AS net
      FROM "journal_lines" jl JOIN "journal_entries" je ON je."id" = jl."entryId"
      WHERE ${Prisma.join(conds, ' AND ')} AND jl."date" < ${fromDateOnly(f.from)} ${hide}`
    opening = D(o.net).times(sign)
  }
  const range: Prisma.Sql[] = []
  if (f.from) range.push(Prisma.sql`AND jl."date" >= ${fromDateOnly(f.from)}`)
  if (f.to) range.push(Prisma.sql`AND jl."date" <= ${fromDateOnly(f.to)}`)

  const lines = await client.$queryRaw<
    {
      lineId: number
      date: Date
      entryId: number
      number: string
      sourceType: string
      sourceId: number | null
      lineDescription: string | null
      entryDescription: string
      debit: string
      credit: string
      status: string
      reversalOfId: number | null
    }[]
  >`
    SELECT jl."id" AS "lineId", jl."date", je."id" AS "entryId", je."number", je."sourceType", je."sourceId",
           jl."description" AS "lineDescription", je."description" AS "entryDescription",
           jl."debit"::text AS debit, jl."credit"::text AS credit, je."status", je."reversalOfId"
    FROM "journal_lines" jl JOIN "journal_entries" je ON je."id" = jl."entryId"
    WHERE ${Prisma.join(conds, ' AND ')} ${range.length ? Prisma.join(range, ' ') : Prisma.empty} ${hide}
    ORDER BY jl."date" ASC, je."id" ASC, jl."lineOrder" ASC`

  let running = opening
  let totalDebit = D(0)
  let totalCredit = D(0)
  const rows: StatementRow[] = lines.map((l) => {
    const debit = D(l.debit)
    const credit = D(l.credit)
    totalDebit = totalDebit.plus(debit)
    totalCredit = totalCredit.plus(credit)
    running = running.plus(debit.minus(credit).times(sign))
    return {
      lineId: l.lineId,
      date: toDateOnly(l.date),
      entryId: l.entryId,
      entryNumber: l.number,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      description: l.lineDescription || l.entryDescription,
      debit: debit.toString(),
      credit: credit.toString(),
      balance: running.toString(),
      reversed: l.status === 'REVERSED',
      isReversal: l.reversalOfId !== null,
    }
  })
  return {
    opening: opening.toString(),
    rows,
    closing: running.toString(),
    totalDebit: totalDebit.toString(),
    totalCredit: totalCredit.toString(),
  }
}

/** رابط المستند المصدر لسطر في كشف الحساب. */
export function sourceHref(sourceType: string, sourceId: number | null): string | null {
  if (!sourceId) return null
  if (sourceType.startsWith('CHARGE')) return `/charges/${sourceId}`
  if (sourceType.startsWith('RECEIPT')) return `/receipts/${sourceId}`
  if (sourceType.startsWith('VOUCHER')) return `/vouchers/${sourceId}`
  if (sourceType.startsWith('TRANSFER')) return `/treasury/transfers?highlight=${sourceId}`
  if (sourceType.startsWith('PAYROLL')) return `/payroll/${sourceId}`
  if (sourceType.startsWith('SUPPLIER_BILL')) return `/suppliers/bills/${sourceId}`
  if (sourceType.startsWith('CONTRACTOR_JOB')) return `/contractors/jobs/${sourceId}`
  return null
}
