import 'server-only'
import { db } from '../db'
import { getSettings } from '../settings'
import { accountIdByKey } from '../ledger/accounts'
import { categoryTotals } from './pnl'
import { cashAccountsSummary } from './treasury'
import { D, sum } from '@/lib/money'
import { addDays, addMonths, endOfMonth, fromDateOnly, parts, startOfMonth, toDateOnly, todayInTimeZone, type DateOnly } from '@/lib/dates'

/**
 * بيانات لوحة التحكم (docs/06-ux-design.md §6.4) — كل رقم محسوب لحظيًا من قاعدة البيانات.
 * الأرقام الشهرية = الشهر الحالي؛ أرقام السنة = السنة الدراسية المختارة.
 */

export interface DashboardYear {
  id: number
  name: string
  startDate: DateOnly
  endDate: DateOnly
}

export interface MonthPoint {
  key: string
  year: number
  month: number
  collections: string
  expenses: string
}

export async function dashboardData(year: DashboardYear | null) {
  const settings = await getSettings()
  const today = todayInTimeZone(settings.finance.timezone)
  const monthStart = startOfMonth(today)
  const monthEnd = endOfMonth(today)
  const overdueBefore = fromDateOnly(addDays(today, -settings.finance.graceDays))
  const ms = fromDateOnly(monthStart)
  const me = fromDateOnly(monthEnd)

  const [[open], [overdue], [dueMonth], [collectedMonth], [receiptsMonth], [vouchersMonth], cash] = await Promise.all([
    db.$queryRaw<{ students: bigint; amount: string }[]>`
      SELECT COUNT(DISTINCT i."studentId") AS students, COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."status" IN ('UNPAID', 'PARTIAL') AND c."status" = 'ACTIVE'`,
    db.$queryRaw<{ students: bigint; amount: string; count: bigint }[]>`
      SELECT COUNT(DISTINCT i."studentId") AS students, COUNT(*) AS count, COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."dueDate" < ${overdueBefore} AND i."status" IN ('UNPAID', 'PARTIAL') AND c."status" = 'ACTIVE'`,
    db.$queryRaw<{ amount: string; count: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."dueDate" BETWEEN ${ms} AND ${me} AND i."status" IN ('UNPAID', 'PARTIAL') AND c."status" = 'ACTIVE'`,
    db.$queryRaw<{ amount: string; count: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM("amount"), 0)::text AS amount FROM "receipts"
      WHERE "status" = 'ACTIVE' AND "kind" IN ('STUDENT', 'FAMILY') AND "date" BETWEEN ${ms} AND ${me}`,
    db.$queryRaw<{ amount: string; count: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM("amount"), 0)::text AS amount FROM "receipts"
      WHERE "status" = 'ACTIVE' AND "kind" <> 'OPENING_CREDIT' AND "date" BETWEEN ${ms} AND ${me}`,
    db.$queryRaw<{ amount: string; count: bigint }[]>`
      SELECT COUNT(*) AS count, COALESCE(SUM("amount"), 0)::text AS amount FROM "payment_vouchers"
      WHERE "status" = 'ACTIVE' AND "date" BETWEEN ${ms} AND ${me}`,
    cashAccountsSummary(db),
  ])
  const active = cash.filter((c) => c.isActive)
  const cashboxes = sum(active.filter((c) => c.type === 'CASHBOX').map((c) => c.balance))
  const banks = sum(active.filter((c) => c.type === 'BANK').map((c) => c.balance))

  let yearData: {
    charged: string
    paid: string
    discounts: string
    expenses: string
    salaries: string
    monthly: MonthPoint[]
    categories: { accountId: number; name: string; total: string }[]
    grades: { gradeId: number; name: string; net: string; paid: string; students: number }[]
  } | null = null

  if (year) {
    const from = year.startDate
    const to = year.endDate
    const [charges, discounts, expenseTotals, salariesId, collections, expenses, grades] = await Promise.all([
      db.charge.aggregate({ where: { academicYearId: year.id, status: 'ACTIVE' }, _sum: { netAmount: true, paidAmount: true } }),
      db.charge.aggregate({ where: { academicYearId: year.id, status: 'ACTIVE' }, _sum: { discountAmount: true } }),
      categoryTotals(db, 'EXPENSE', { from, to }),
      accountIdByKey(db, 'SALARIES_EXPENSE'),
      db.$queryRaw<{ m: Date; amount: string }[]>`
        SELECT date_trunc('month', "date")::date AS m, COALESCE(SUM("amount"), 0)::text AS amount FROM "receipts"
        WHERE "status" = 'ACTIVE' AND "kind" IN ('STUDENT', 'FAMILY') AND "date" BETWEEN ${fromDateOnly(from)} AND ${fromDateOnly(to)}
        GROUP BY 1`,
      db.$queryRaw<{ m: Date; amount: string }[]>`
        SELECT date_trunc('month', jl."date")::date AS m, COALESCE(SUM(jl."debit" - jl."credit"), 0)::text AS amount
        FROM "journal_lines" jl JOIN "accounts" a ON a."id" = jl."accountId"
        WHERE a."type" = 'EXPENSE' AND jl."date" BETWEEN ${fromDateOnly(from)} AND ${fromDateOnly(to)}
        GROUP BY 1`,
      db.$queryRaw<{ gradeId: number; name: string; net: string; paid: string; students: bigint }[]>`
        SELECT g."id" AS "gradeId", g."name", COALESCE(SUM(c."netAmount"), 0)::text AS net, COALESCE(SUM(c."paidAmount"), 0)::text AS paid,
               COUNT(DISTINCT c."studentId") AS students
        FROM "charges" c
        JOIN "enrollments" e ON e."studentId" = c."studentId" AND e."academicYearId" = c."academicYearId"
        JOIN "grades" g ON g."id" = e."gradeId"
        WHERE c."academicYearId" = ${year.id} AND c."status" = 'ACTIVE'
        GROUP BY g."id", g."name", g."sortOrder"
        ORDER BY g."sortOrder" ASC, g."name" ASC`,
    ])
    // سلسلة الأشهر من بداية السنة حتى نهايتها (أو الشهر الحالي إن كانت السنة جارية)
    const byMonth = (rows: { m: Date; amount: string }[]) => new Map(rows.map((r) => [toDateOnly(r.m).slice(0, 7), D(r.amount).toString()]))
    const cMap = byMonth(collections)
    const eMap = byMonth(expenses)
    const monthly: MonthPoint[] = []
    const lastMonth = to < monthEnd ? to : monthEnd
    for (let d = startOfMonth(from); d <= lastMonth; d = addMonths(d, 1, 1)) {
      const { y, m } = parts(d)
      const key = d.slice(0, 7)
      monthly.push({ key, year: y, month: m, collections: cMap.get(key) ?? '0', expenses: eMap.get(key) ?? '0' })
      if (monthly.length > 24) break
    }
    const nonZero = expenseTotals.filter((t) => D(t.total).greaterThan(0)).sort((a, b) => D(b.total).comparedTo(D(a.total)))
    const top = nonZero.slice(0, 6).map((t) => ({ accountId: t.accountId, name: t.name, total: t.total }))
    const rest = sum(nonZero.slice(6).map((t) => t.total))
    if (rest.greaterThan(0)) top.push({ accountId: 0, name: 'أخرى', total: rest.toString() })
    yearData = {
      charged: D(charges._sum.netAmount).toString(),
      paid: D(charges._sum.paidAmount).toString(),
      discounts: D(discounts._sum.discountAmount).toString(),
      expenses: sum(expenseTotals.map((t) => t.total)).toString(),
      salaries: D(expenseTotals.find((t) => t.accountId === salariesId)?.total ?? 0).toString(),
      monthly,
      categories: top,
      grades: grades.map((g) => ({ gradeId: Number(g.gradeId), name: g.name, net: D(g.net).toString(), paid: D(g.paid).toString(), students: Number(g.students) })),
    }
  }

  return {
    today,
    month: { start: monthStart, end: monthEnd },
    outstanding: { amount: D(open.amount).toString(), students: Number(open.students) },
    overdue: { amount: D(overdue.amount).toString(), students: Number(overdue.students), installments: Number(overdue.count) },
    dueThisMonth: { amount: D(dueMonth.amount).toString(), installments: Number(dueMonth.count) },
    collectedThisMonth: { amount: D(collectedMonth.amount).toString(), receipts: Number(collectedMonth.count) },
    receiptsThisMonth: { amount: D(receiptsMonth.amount).toString(), count: Number(receiptsMonth.count) },
    vouchersThisMonth: { amount: D(vouchersMonth.amount).toString(), count: Number(vouchersMonth.count) },
    cash: { cashboxes: cashboxes.toString(), banks: banks.toString() },
    year: yearData,
  }
}

export async function latestDocuments(limit = 6) {
  const [receipts, vouchers] = await Promise.all([
    db.receipt.findMany({
      where: { kind: { not: 'OPENING_CREDIT' } },
      select: { id: true, number: true, date: true, amount: true, payerName: true, status: true, kind: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    }),
    db.paymentVoucher.findMany({
      select: { id: true, number: true, date: true, amount: true, payeeName: true, status: true, kind: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    }),
  ])
  return { receipts, vouchers }
}
