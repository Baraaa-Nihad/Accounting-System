import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { StudentStatus } from '@/generated/prisma/enums'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { nextPlainNumber } from '../numbering'
import { getSettings } from '../settings'
import { createGuardian, findGuardianByPhone } from './guardians'
import { buildSearchText, normalizeArabic, prepareSearchQuery } from '@/lib/arabic'
import { addDays, fromDateOnly, todayInTimeZone } from '@/lib/dates'
import { D } from '@/lib/money'
import type { studentSchema, studentStatusSchema } from '@/lib/schemas/students'
import type { z } from 'zod'
import { STUDENT_STATUS } from '@/lib/labels'

type StudentData = z.output<typeof studentSchema>

export async function refreshStudentSearchText(tx: DbOrTx, studentId: number) {
  const s = await tx.student.findUnique({ where: { id: studentId }, include: { guardian: true } })
  if (!s) return
  const searchText = buildSearchText([
    s.fullName,
    s.studentNumber,
    s.schoolNumber,
    s.nationalId,
    s.guardian?.name,
    s.guardian?.phone,
    s.guardian?.phone2,
  ])
  await tx.student.update({ where: { id: studentId }, data: { searchText } })
}

async function assertGradeSection(tx: DbOrTx, gradeId: number, sectionId: number | null) {
  const grade = await tx.grade.findUnique({ where: { id: gradeId } })
  if (!grade) throw new BusinessError('الصف غير موجود', { gradeId: 'اختر الصف' })
  if (sectionId) {
    const section = await tx.section.findUnique({ where: { id: sectionId } })
    if (!section || section.gradeId !== gradeId) throw new BusinessError('الشعبة لا تتبع الصف المختار', { sectionId: 'اختر شعبة من شعب الصف' })
  }
  return grade
}

/** فحص التكرار: نفس الاسم لنفس ولي الأمر أو نفس الرقم المدرسي. */
async function findDuplicate(tx: DbOrTx, data: { fullName: string; schoolNumber: string | null; guardianId: number | null; excludeId?: number }) {
  if (data.schoolNumber) {
    const bySchool = await tx.student.findFirst({
      where: { schoolNumber: data.schoolNumber, ...(data.excludeId ? { id: { not: data.excludeId } } : {}) },
    })
    if (bySchool) {
      throw new BusinessError(`الرقم المدرسي ${data.schoolNumber} مستخدم للطالب ${bySchool.fullName}`, {
        schoolNumber: 'الرقم المدرسي مستخدم لطالب آخر',
      })
    }
  }
  if (data.guardianId) {
    const siblings = await tx.student.findMany({
      where: { guardianId: data.guardianId, ...(data.excludeId ? { id: { not: data.excludeId } } : {}) },
      select: { id: true, fullName: true, studentNumber: true },
    })
    const name = normalizeArabic(data.fullName)
    const same = siblings.find((s) => normalizeArabic(s.fullName) === name)
    if (same) return same
  }
  return null
}

export async function createStudent(tx: Tx, ctx: Ctx, input: StudentData) {
  const grade = await assertGradeSection(tx, input.gradeId, input.sectionId)
  const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId } })
  if (!year) throw new BusinessError('السنة الدراسية غير موجودة', { academicYearId: 'اختر السنة الدراسية' })

  // ولي الأمر: موجود مسبقًا أو جديد (مع ربط تلقائي إن وُجد بنفس الهاتف)
  let guardianId = input.guardianId
  if (!guardianId) {
    if (!input.guardian) throw new BusinessError('بيانات ولي الأمر مطلوبة', { 'guardian.name': 'اسم ولي الأمر مطلوب' })
    const existing = await findGuardianByPhone(tx, input.guardian.phone)
    guardianId = existing ? existing.id : (await createGuardian(tx, ctx, input.guardian)).id
  } else {
    const g = await tx.guardian.findUnique({ where: { id: guardianId } })
    if (!g) throw new BusinessError('ولي الأمر المختار غير موجود')
  }

  const duplicate = await findDuplicate(tx, { fullName: input.fullName, schoolNumber: input.schoolNumber, guardianId })
  if (duplicate && !input.confirmDuplicate) {
    throw new BusinessError(`يوجد طالب مسجل بنفس الاسم لنفس ولي الأمر: ${duplicate.fullName} (رقم ${duplicate.studentNumber}).`, {
      _duplicate: 'تأكد أنه ليس نفس الطالب، ثم اختر «حفظ رغم التشابه» إن كان طالبًا مختلفًا.',
    })
  }

  const studentNumber = await nextPlainNumber(tx, 'student', async (n) => !!(await tx.student.findUnique({ where: { studentNumber: n } })))
  const student = await tx.student.create({
    data: {
      studentNumber,
      schoolNumber: input.schoolNumber,
      fullName: input.fullName,
      gender: input.gender,
      birthDate: input.birthDate ? fromDateOnly(input.birthDate) : null,
      nationalId: input.nationalId,
      joinDate: input.joinDate ? fromDateOnly(input.joinDate) : null,
      address: input.address,
      notes: input.notes,
      guardianId,
      createdById: ctx.userId,
      enrollments: {
        create: { academicYearId: input.academicYearId, gradeId: input.gradeId, sectionId: input.sectionId },
      },
    },
  })
  await refreshStudentSearchText(tx, student.id)
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Student',
    entityId: student.id,
    entityLabel: `${student.fullName} (${student.studentNumber})`,
    summary: `إضافة طالب: ${student.fullName} — ${grade.name} — ${year.name}`,
    after: { ...student, gradeId: input.gradeId, sectionId: input.sectionId, academicYearId: input.academicYearId },
  })
  return student
}

export async function updateStudent(tx: Tx, ctx: Ctx, studentId: number, input: StudentData) {
  const before = await tx.student.findUnique({
    where: { id: studentId },
    include: { enrollments: { where: { academicYearId: input.academicYearId } } },
  })
  if (!before) throw new BusinessError('الطالب غير موجود')
  await assertGradeSection(tx, input.gradeId, input.sectionId)

  let guardianId = input.guardianId ?? before.guardianId
  if (!guardianId && input.guardian) {
    const existing = await findGuardianByPhone(tx, input.guardian.phone)
    guardianId = existing ? existing.id : (await createGuardian(tx, ctx, input.guardian)).id
  }
  await findDuplicate(tx, { fullName: input.fullName, schoolNumber: input.schoolNumber, guardianId, excludeId: studentId }).then((dup) => {
    if (dup && !input.confirmDuplicate) {
      throw new BusinessError(`يوجد طالب آخر بنفس الاسم لنفس ولي الأمر: ${dup.fullName} (رقم ${dup.studentNumber}).`, {
        _duplicate: 'تأكد أنه ليس نفس الطالب.',
      })
    }
  })

  const after = await tx.student.update({
    where: { id: studentId },
    data: {
      schoolNumber: input.schoolNumber,
      fullName: input.fullName,
      gender: input.gender,
      birthDate: input.birthDate ? fromDateOnly(input.birthDate) : null,
      nationalId: input.nationalId,
      joinDate: input.joinDate ? fromDateOnly(input.joinDate) : null,
      address: input.address,
      notes: input.notes,
      guardianId,
    },
  })
  const enrollment = before.enrollments[0]
  if (enrollment) {
    await tx.enrollment.update({ where: { id: enrollment.id }, data: { gradeId: input.gradeId, sectionId: input.sectionId } })
  } else {
    await tx.enrollment.create({
      data: { studentId, academicYearId: input.academicYearId, gradeId: input.gradeId, sectionId: input.sectionId },
    })
  }
  await refreshStudentSearchText(tx, studentId)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'Student',
    entityId: studentId,
    entityLabel: `${after.fullName} (${after.studentNumber})`,
    summary: `تعديل بيانات الطالب ${after.fullName}`,
    before: { ...before, enrollments: undefined, gradeId: enrollment?.gradeId, sectionId: enrollment?.sectionId },
    after: { ...after, gradeId: input.gradeId, sectionId: input.sectionId },
  })
  return after
}

export async function changeStudentStatus(tx: Tx, ctx: Ctx, input: z.output<typeof studentStatusSchema>) {
  const before = await tx.student.findUnique({ where: { id: input.studentId } })
  if (!before) throw new BusinessError('الطالب غير موجود')
  if (before.status === input.status) throw new BusinessError('الحالة المختارة هي الحالة الحالية نفسها')
  const after = await tx.student.update({
    where: { id: input.studentId },
    data: {
      status: input.status as StudentStatus,
      statusReason: input.reason,
      statusChangedAt: new Date(),
    },
  })
  let cancelledNote = ''
  if (input.status === 'WITHDRAWN' && input.cancelFutureInstallments && input.date) {
    const { cancelFutureInstallmentsForWithdrawal } = await import('./charges')
    const result = await cancelFutureInstallmentsForWithdrawal(tx, ctx, input.studentId, input.date, input.reason ?? 'انسحاب الطالب')
    if (D(result.total).greaterThan(0)) cancelledNote = ` وإلغاء أقساط غير مستحقة بقيمة ${result.total}`
  }
  await audit(tx, ctx, {
    action: 'status',
    entityType: 'Student',
    entityId: input.studentId,
    entityLabel: `${after.fullName} (${after.studentNumber})`,
    summary: `تغيير حالة الطالب ${after.fullName} من «${STUDENT_STATUS[before.status].label}» إلى «${STUDENT_STATUS[input.status].label}»${input.reason ? ` — السبب: ${input.reason}` : ''}${cancelledNote}`,
    before: { status: before.status, statusReason: before.statusReason },
    after: { status: after.status, statusReason: after.statusReason, date: input.date },
  })
  return after
}

// ---------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------

export interface StudentListFilters {
  q?: string
  yearId?: number | null
  gradeId?: number
  sectionId?: number
  status?: string
  balance?: 'owing' | 'overdue' | 'credit' | 'clear'
  guardianId?: number
  /** افتراضيًا عند تحديد سنة تُعرض فقط الطلاب المسجلون فيها */
  onlyEnrolled?: boolean
  page?: number
  pageSize?: number
  sort?: 'name' | 'number' | 'balance' | 'grade'
}

export interface StudentListRow {
  id: number
  studentNumber: string
  schoolNumber: string | null
  fullName: string
  status: StudentStatus
  guardianId: number | null
  guardianName: string | null
  guardianPhone: string | null
  gradeName: string | null
  sectionName: string | null
  gross: string
  discount: string
  net: string
  paid: string
  credit: string
  overdue: string
  remaining: string
}

export async function listStudents(filters: StudentListFilters, client: DbOrTx = db) {
  const settings = await getSettings(client)
  const today = todayInTimeZone(settings.finance.timezone)
  const overdueBefore = fromDateOnly(addDays(today, -settings.finance.graceDays))
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 5), 500)
  const page = Math.max(filters.page ?? 1, 1)
  const yearId = filters.yearId ?? null

  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (filters.q) {
    const { text, digits } = prepareSearchQuery(filters.q)
    if (text) {
      const like = `%${text}%`
      const likeDigits = digits.length >= 3 ? `%${digits}%` : null
      conds.push(likeDigits ? Prisma.sql`(s."searchText" LIKE ${like} OR s."searchText" LIKE ${likeDigits})` : Prisma.sql`s."searchText" LIKE ${like}`)
    }
  }
  if (yearId && filters.onlyEnrolled !== false) conds.push(Prisma.sql`e."id" IS NOT NULL`)
  if (filters.gradeId) conds.push(Prisma.sql`e."gradeId" = ${filters.gradeId}`)
  if (filters.sectionId) conds.push(Prisma.sql`e."sectionId" = ${filters.sectionId}`)
  if (filters.status && ['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'SUSPENDED'].includes(filters.status)) {
    conds.push(Prisma.sql`s."status" = ${filters.status}::"StudentStatus"`)
  }
  if (filters.guardianId) conds.push(Prisma.sql`s."guardianId" = ${filters.guardianId}`)
  if (filters.balance === 'owing') conds.push(Prisma.sql`COALESCE(ch.net, 0) - COALESCE(ch.paid, 0) > 0`)
  if (filters.balance === 'overdue') conds.push(Prisma.sql`COALESCE(od.overdue, 0) > 0`)
  if (filters.balance === 'credit') conds.push(Prisma.sql`COALESCE(cr.credit, 0) > 0`)
  if (filters.balance === 'clear') conds.push(Prisma.sql`COALESCE(ch.net, 0) - COALESCE(ch.paid, 0) = 0`)

  const order =
    filters.sort === 'number'
      ? Prisma.sql`s."studentNumber" ASC`
      : filters.sort === 'balance'
        ? Prisma.sql`(COALESCE(ch.net, 0) - COALESCE(ch.paid, 0)) DESC, s."fullName" ASC`
        : filters.sort === 'grade'
          ? Prisma.sql`gr."sortOrder" ASC NULLS LAST, sec."name" ASC NULLS LAST, s."fullName" ASC`
          : Prisma.sql`s."fullName" ASC`

  const base = Prisma.sql`
    FROM "students" s
    LEFT JOIN "guardians" g ON g."id" = s."guardianId"
    LEFT JOIN "enrollments" e ON e."studentId" = s."id" AND e."academicYearId" = ${yearId ?? -1}
    LEFT JOIN "grades" gr ON gr."id" = e."gradeId"
    LEFT JOIN "sections" sec ON sec."id" = e."sectionId"
    LEFT JOIN (
      SELECT "studentId", SUM("grossAmount") AS gross, SUM("discountAmount") AS discount,
             SUM("netAmount") AS net, SUM("paidAmount") AS paid
      FROM "charges" WHERE "status" = 'ACTIVE' GROUP BY "studentId"
    ) ch ON ch."studentId" = s."id"
    LEFT JOIN (
      SELECT pa."studentId", SUM(pa."amount") AS credit
      FROM "payment_allocations" pa JOIN "receipts" r ON r."id" = pa."receiptId"
      WHERE r."status" = 'ACTIVE' AND pa."installmentId" IS NULL AND pa."refundVoucherId" IS NULL
      GROUP BY pa."studentId"
    ) cr ON cr."studentId" = s."id"
    LEFT JOIN (
      SELECT i."studentId", SUM(i."amount" - i."paidAmount") AS overdue
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE c."status" = 'ACTIVE' AND i."status" IN ('UNPAID', 'PARTIAL') AND i."dueDate" < ${overdueBefore}
      GROUP BY i."studentId"
    ) od ON od."studentId" = s."id"
    WHERE ${Prisma.join(conds, ' AND ')}`

  const [rows, countRows, totalsRows] = await Promise.all([
    client.$queryRaw<StudentListRow[]>`
      SELECT s."id", s."studentNumber", s."schoolNumber", s."fullName", s."status",
             s."guardianId", g."name" AS "guardianName", g."phone" AS "guardianPhone",
             gr."name" AS "gradeName", sec."name" AS "sectionName",
             COALESCE(ch.gross, 0)::text AS gross, COALESCE(ch.discount, 0)::text AS discount,
             COALESCE(ch.net, 0)::text AS net, COALESCE(ch.paid, 0)::text AS paid,
             COALESCE(cr.credit, 0)::text AS credit, COALESCE(od.overdue, 0)::text AS overdue,
             (COALESCE(ch.net, 0) - COALESCE(ch.paid, 0))::text AS remaining
      ${base}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    client.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count ${base}`,
    client.$queryRaw<{ remaining: string; overdue: string; credit: string }[]>`
      SELECT COALESCE(SUM(COALESCE(ch.net, 0) - COALESCE(ch.paid, 0)), 0)::text AS remaining,
             COALESCE(SUM(COALESCE(od.overdue, 0)), 0)::text AS overdue,
             COALESCE(SUM(COALESCE(cr.credit, 0)), 0)::text AS credit
      ${base}`,
  ])
  const total = Number(countRows[0]?.count ?? 0)
  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    totals: totalsRows[0],
  }
}

/** الملخص المالي للطالب (مطابق لرصيده في الأستاذ العام). */
export async function studentFinancialSummary(client: DbOrTx, studentId: number) {
  const settings = await getSettings(client)
  const today = todayInTimeZone(settings.finance.timezone)
  const overdueBefore = fromDateOnly(addDays(today, -settings.finance.graceDays))
  const [charges, payments, overdue, dueSoon] = await Promise.all([
    client.charge.aggregate({
      where: { studentId, status: 'ACTIVE' },
      _sum: { grossAmount: true, discountAmount: true, netAmount: true, paidAmount: true },
    }),
    client.$queryRaw<{ paid: string; credit: string; refunded: string }[]>`
      SELECT COALESCE(SUM(pa."amount") FILTER (WHERE pa."refundVoucherId" IS NULL), 0)::text AS paid,
             COALESCE(SUM(pa."amount") FILTER (WHERE pa."installmentId" IS NULL AND pa."refundVoucherId" IS NULL), 0)::text AS credit,
             COALESCE(SUM(pa."amount") FILTER (WHERE pa."refundVoucherId" IS NOT NULL), 0)::text AS refunded
      FROM "payment_allocations" pa JOIN "receipts" r ON r."id" = pa."receiptId"
      WHERE pa."studentId" = ${studentId} AND r."status" = 'ACTIVE'`,
    client.$queryRaw<{ amount: string; count: bigint }[]>`
      SELECT COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount, COUNT(*) AS count
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."studentId" = ${studentId} AND c."status" = 'ACTIVE' AND i."status" IN ('UNPAID', 'PARTIAL')
        AND i."dueDate" < ${overdueBefore}`,
    client.$queryRaw<{ amount: string }[]>`
      SELECT COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."studentId" = ${studentId} AND c."status" = 'ACTIVE' AND i."status" IN ('UNPAID', 'PARTIAL')
        AND i."dueDate" <= ${fromDateOnly(today)}`,
  ])
  const gross = D(charges._sum.grossAmount)
  const discount = D(charges._sum.discountAmount)
  const net = D(charges._sum.netAmount)
  const paidToCharges = D(charges._sum.paidAmount)
  const credit = D(payments[0]?.credit)
  const paid = D(payments[0]?.paid)
  const refunded = D(payments[0]?.refunded)
  return {
    gross: gross.toString(),
    discount: discount.toString(),
    net: net.toString(),
    paid: paid.toString(), // كل ما دفعه الطالب ولم يُرد
    paidToCharges: paidToCharges.toString(),
    credit: credit.toString(), // رصيد دائن غير موزع
    refunded: refunded.toString(),
    remaining: net.minus(paidToCharges).toString(), // المتبقي على الذمم
    balance: net.minus(paidToCharges).minus(credit).toString(), // صافي الرصيد (سالب = للطالب)
    overdue: D(overdue[0]?.amount).toString(),
    overdueCount: Number(overdue[0]?.count ?? 0),
    dueNow: D(dueSoon[0]?.amount).toString(),
  }
}

export async function getStudentProfile(client: DbOrTx, studentId: number) {
  return client.student.findUnique({
    where: { id: studentId },
    include: {
      guardian: {
        include: {
          students: {
            select: { id: true, fullName: true, studentNumber: true, status: true },
            orderBy: { fullName: 'asc' },
          },
        },
      },
      enrollments: {
        include: { academicYear: true, grade: { include: { stage: true } }, section: true },
        orderBy: { academicYear: { startDate: 'desc' } },
      },
    },
  })
}
