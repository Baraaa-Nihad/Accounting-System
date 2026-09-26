import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db, type DbOrTx } from '../db'
import { getSettings } from '../settings'
import { addDays, endOfMonth, endOfWeek, fromDateOnly, startOfMonth, startOfWeek, todayInTimeZone, type DateOnly } from '@/lib/dates'
import { prepareSearchQuery } from '@/lib/arabic'
import { toDb } from '@/lib/money'

/**
 * استعلامات الذمم والأقساط والخصومات (تُستخدم في الصفحات والتقارير).
 */

export interface ChargeListFilters {
  q?: string
  yearId?: number
  chargeTypeId?: number
  gradeId?: number
  sectionId?: number
  studentId?: number
  status?: string
  paymentStatus?: string
  from?: DateOnly
  to?: DateOnly
  userId?: number
  minAmount?: string
  maxAmount?: string
  page?: number
  pageSize?: number
}

function studentSearch(q?: string): Prisma.StudentWhereInput | undefined {
  if (!q) return undefined
  const { text, digits } = prepareSearchQuery(q)
  if (!text) return undefined
  return { OR: [{ searchText: { contains: text } }, ...(digits.length >= 3 ? [{ searchText: { contains: digits } }] : [])] }
}

export function chargesWhere(f: ChargeListFilters): Prisma.ChargeWhereInput {
  const and: Prisma.ChargeWhereInput[] = []
  const sw = studentSearch(f.q)
  if (sw) and.push({ student: sw })
  if (f.yearId) and.push({ academicYearId: f.yearId })
  if (f.chargeTypeId) and.push({ chargeTypeId: f.chargeTypeId })
  if (f.studentId) and.push({ studentId: f.studentId })
  if (f.gradeId || f.sectionId) {
    and.push({
      student: {
        enrollments: {
          some: {
            ...(f.yearId ? { academicYearId: f.yearId } : {}),
            ...(f.gradeId ? { gradeId: f.gradeId } : {}),
            ...(f.sectionId ? { sectionId: f.sectionId } : {}),
          },
        },
      },
    })
  }
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.paymentStatus === 'UNPAID' || f.paymentStatus === 'PARTIAL' || f.paymentStatus === 'PAID') and.push({ paymentStatus: f.paymentStatus })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  if (f.userId) and.push({ createdById: f.userId })
  if (f.minAmount) and.push({ grossAmount: { gte: toDb(f.minAmount) } })
  if (f.maxAmount) and.push({ grossAmount: { lte: toDb(f.maxAmount) } })
  return and.length ? { AND: and } : {}
}

export async function listCharges(f: ChargeListFilters, client: DbOrTx = db) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 5000)
  const page = Math.max(f.page ?? 1, 1)
  const where = chargesWhere(f)
  const [rows, total, sums] = await Promise.all([
    client.charge.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true, studentNumber: true } },
        chargeType: { select: { name: true } },
        academicYear: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.charge.count({ where }),
    client.charge.aggregate({
      where: { AND: [where, { status: 'ACTIVE' }] },
      _sum: { grossAmount: true, discountAmount: true, netAmount: true, paidAmount: true },
    }),
  ])
  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    sums: {
      gross: sums._sum.grossAmount?.toString() ?? '0',
      discount: sums._sum.discountAmount?.toString() ?? '0',
      net: sums._sum.netAmount?.toString() ?? '0',
      paid: sums._sum.paidAmount?.toString() ?? '0',
    },
  }
}

export type DuePeriod = 'today' | 'week' | 'month' | 'overdue' | 'due' | 'upcoming' | 'all' | 'range'

export interface InstallmentFilters {
  period?: DuePeriod
  from?: DateOnly
  to?: DateOnly
  yearId?: number
  gradeId?: number
  sectionId?: number
  chargeTypeId?: number
  studentId?: number
  q?: string
  minAmount?: string
  page?: number
  pageSize?: number
}

export interface InstallmentRow {
  id: number
  number: number
  dueDate: Date
  amount: string
  paidAmount: string
  remaining: string
  status: string
  chargeId: number
  chargeTypeName: string
  installmentCount: number
  studentId: number
  studentName: string
  studentNumber: string
  studentStatus: string
  guardianName: string | null
  guardianPhone: string | null
  gradeName: string | null
  sectionName: string | null
  yearName: string
}

/** الأقساط المفتوحة حسب فترة الاستحقاق (اليوم، الأسبوع، الشهر، المتأخرة...). */
export async function listInstallments(f: InstallmentFilters, client: DbOrTx = db) {
  const settings = await getSettings(client)
  const today = todayInTimeZone(settings.finance.timezone)
  const overdueBefore = addDays(today, -settings.finance.graceDays)
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 5), 10000)
  const page = Math.max(f.page ?? 1, 1)
  const conds: Prisma.Sql[] = [
    Prisma.sql`c."status" = 'ACTIVE'`,
    Prisma.sql`i."status" IN ('UNPAID', 'PARTIAL')`,
    Prisma.sql`i."amount" > i."paidAmount"`,
  ]
  const period = f.period ?? 'due'
  const range = (a: DateOnly, b: DateOnly) => Prisma.sql`i."dueDate" BETWEEN ${fromDateOnly(a)} AND ${fromDateOnly(b)}`
  if (period === 'today') conds.push(Prisma.sql`i."dueDate" = ${fromDateOnly(today)}`)
  else if (period === 'week') conds.push(range(startOfWeek(today, settings.finance.weekStartDay), endOfWeek(today, settings.finance.weekStartDay)))
  else if (period === 'month') conds.push(range(startOfMonth(today), endOfMonth(today)))
  else if (period === 'overdue') conds.push(Prisma.sql`i."dueDate" < ${fromDateOnly(overdueBefore)}`)
  else if (period === 'due') conds.push(Prisma.sql`i."dueDate" <= ${fromDateOnly(today)}`)
  else if (period === 'upcoming') conds.push(Prisma.sql`i."dueDate" > ${fromDateOnly(today)}`)
  else if (period === 'range') {
    if (f.from) conds.push(Prisma.sql`i."dueDate" >= ${fromDateOnly(f.from)}`)
    if (f.to) conds.push(Prisma.sql`i."dueDate" <= ${fromDateOnly(f.to)}`)
  }
  if (f.yearId) conds.push(Prisma.sql`c."academicYearId" = ${f.yearId}`)
  if (f.chargeTypeId) conds.push(Prisma.sql`c."chargeTypeId" = ${f.chargeTypeId}`)
  if (f.studentId) conds.push(Prisma.sql`i."studentId" = ${f.studentId}`)
  if (f.gradeId) conds.push(Prisma.sql`e."gradeId" = ${f.gradeId}`)
  if (f.sectionId) conds.push(Prisma.sql`e."sectionId" = ${f.sectionId}`)
  if (f.minAmount) conds.push(Prisma.sql`(i."amount" - i."paidAmount") >= ${toDb(f.minAmount)}::numeric`)
  if (f.q) {
    const { text, digits } = prepareSearchQuery(f.q)
    if (text) conds.push(digits.length >= 3 ? Prisma.sql`(s."searchText" LIKE ${`%${text}%`} OR s."searchText" LIKE ${`%${digits}%`})` : Prisma.sql`s."searchText" LIKE ${`%${text}%`}`)
  }
  const current = await client.academicYear.findFirst({ where: { isCurrent: true } })
  const enrollYear = f.yearId ?? current?.id ?? -1
  const base = Prisma.sql`
    FROM "installments" i
    JOIN "charges" c ON c."id" = i."chargeId"
    JOIN "charge_types" ct ON ct."id" = c."chargeTypeId"
    JOIN "academic_years" ay ON ay."id" = c."academicYearId"
    JOIN "students" s ON s."id" = i."studentId"
    LEFT JOIN "guardians" g ON g."id" = s."guardianId"
    LEFT JOIN "enrollments" e ON e."studentId" = s."id" AND e."academicYearId" = ${enrollYear}
    LEFT JOIN "grades" gr ON gr."id" = e."gradeId"
    LEFT JOIN "sections" sec ON sec."id" = e."sectionId"
    WHERE ${Prisma.join(conds, ' AND ')}`
  const [rows, agg] = await Promise.all([
    client.$queryRaw<InstallmentRow[]>`
      SELECT i."id", i."number", i."dueDate", i."amount"::text AS amount, i."paidAmount"::text AS "paidAmount",
             (i."amount" - i."paidAmount")::text AS remaining, i."status"::text AS status,
             c."id" AS "chargeId", ct."name" AS "chargeTypeName", c."installmentCount",
             s."id" AS "studentId", s."fullName" AS "studentName", s."studentNumber", s."status"::text AS "studentStatus",
             g."name" AS "guardianName", g."phone" AS "guardianPhone",
             gr."name" AS "gradeName", sec."name" AS "sectionName", ay."name" AS "yearName"
      ${base}
      ORDER BY i."dueDate" ASC, s."fullName" ASC, i."number" ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    client.$queryRaw<{ count: bigint; students: bigint; remaining: string; amount: string; paid: string }[]>`
      SELECT COUNT(*) AS count, COUNT(DISTINCT i."studentId") AS students,
             COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS remaining,
             COALESCE(SUM(i."amount"), 0)::text AS amount, COALESCE(SUM(i."paidAmount"), 0)::text AS paid
      ${base}`,
  ])
  const total = Number(agg[0]?.count ?? 0)
  return {
    rows,
    total,
    students: Number(agg[0]?.students ?? 0),
    remaining: agg[0]?.remaining ?? '0',
    amount: agg[0]?.amount ?? '0',
    paid: agg[0]?.paid ?? '0',
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    today,
    graceDays: settings.finance.graceDays,
  }
}

export interface DiscountFilters {
  q?: string
  yearId?: number
  discountTypeId?: number
  status?: string
  from?: DateOnly
  to?: DateOnly
  userId?: number
  studentId?: number
  page?: number
  pageSize?: number
}

export function discountsWhere(f: DiscountFilters): Prisma.DiscountWhereInput {
  const and: Prisma.DiscountWhereInput[] = []
  const sw = studentSearch(f.q)
  if (sw) and.push({ student: sw })
  if (f.yearId) and.push({ academicYearId: f.yearId })
  if (f.discountTypeId) and.push({ discountTypeId: f.discountTypeId })
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  if (f.userId) and.push({ createdById: f.userId })
  if (f.studentId) and.push({ studentId: f.studentId })
  return and.length ? { AND: and } : {}
}

export async function listDiscounts(f: DiscountFilters, client: DbOrTx = db) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 5000)
  const page = Math.max(f.page ?? 1, 1)
  const where = discountsWhere(f)
  const [rows, total, sums] = await Promise.all([
    client.discount.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true, studentNumber: true } },
        discountType: { select: { name: true } },
        chargeType: { select: { name: true } },
        charge: { include: { chargeType: { select: { name: true } } } },
        createdBy: { select: { fullName: true } },
        academicYear: { select: { name: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.discount.count({ where }),
    client.discount.aggregate({ where: { AND: [where, { status: 'ACTIVE' }] }, _sum: { amount: true, baseAmount: true } }),
  ])
  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    sumAmount: sums._sum.amount?.toString() ?? '0',
    sumBase: sums._sum.baseAmount?.toString() ?? '0',
  }
}
