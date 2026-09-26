import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '../../db'
import { addDays, diffDays, type DateOnly } from '@/lib/dates'
import { D, sum } from '@/lib/money'
import { DISCOUNT_METHOD, DISCOUNT_SCOPE, DOC_STATUS, PAYMENT_METHOD, RECEIPT_KIND, STUDENT_STATUS } from '@/lib/labels'
import { amountRange, andAll, d, dateRange, dt, empty, m, n, searchLike, sql, totalsOf } from '../sql'
import type { ReportDef, ReportEnv, ReportFilters, Row } from '../types'

/** التقارير 1 – 8: ذمم الطلاب، المتأخرون، الأقساط المستحقة والمتأخرة، التحصيل، الخصومات. */

const studentHref = (r: Row) => (r._studentId ? `/students/${r._studentId}` : null)

/** آخر تسجيل للطالب (أو تسجيله في سنة محددة) مع الصف والشعبة. */
function enrollmentLateral(yearId: number | null) {
  return sql`LEFT JOIN LATERAL (
    SELECT gr."name" AS "gradeName", sec."name" AS "sectionName", gr."sortOrder" AS "gradeSort", e."gradeId" AS "gradeId"
    FROM "enrollments" e
    JOIN "academic_years" ay ON ay."id" = e."academicYearId"
    JOIN "grades" gr ON gr."id" = e."gradeId"
    LEFT JOIN "sections" sec ON sec."id" = e."sectionId"
    WHERE e."studentId" = s."id" ${yearId ? sql`AND e."academicYearId" = ${yearId}` : empty}
    ORDER BY ay."startDate" DESC
    LIMIT 1
  ) en ON TRUE`
}

const gradeLabel = (gradeName: unknown, sectionName: unknown) => (gradeName ? `${gradeName}${sectionName ? ` - ${sectionName}` : ''}` : '—')

function overdueBefore(env: ReportEnv): DateOnly {
  return addDays(env.today, -env.settings.finance.graceDays)
}

// ---------------------------------------------------------------------
// 1. ذمم الطلاب
// ---------------------------------------------------------------------

export const studentBalances: ReportDef = {
  id: 'student-balances',
  title: 'تقرير ذمم الطلاب',
  description: 'لكل طالب: إجمالي الذمم، الخصومات، الصافي، المدفوع، المتبقي، والمتأخر منه.',
  group: 'students',
  permissions: ['charges.view'],
  landscape: true,
  filters: [
    { key: 'year', allowAllYears: true },
    { key: 'grade' },
    { key: 'student' },
    {
      key: 'kind',
      label: 'عرض',
      options: [
        { value: 'balance', label: 'عليهم مبالغ متبقية' },
        { value: 'overdue', label: 'عليهم متأخرات' },
        { value: 'paid', label: 'مسددون بالكامل' },
      ],
      defaultValue: 'balance',
      allLabel: 'كل الطلاب',
    },
    { key: 'status', label: 'حالة الطالب', options: Object.entries(STUDENT_STATUS).map(([value, v]) => ({ value, label: v.label })) },
    { key: 'amount', label: 'المتبقي' },
    { key: 'q' },
  ],
  async run(f, env) {
    const y = f.yearId
    const conds: Prisma.Sql[] = []
    if (f.gradeId) conds.push(sql`en."gradeId" = ${f.gradeId}`)
    if (f.studentId) conds.push(sql`s."id" = ${f.studentId}`)
    if (f.status) conds.push(sql`s."status"::text = ${f.status}`)
    if (f.kind === 'balance') conds.push(sql`ch.net - ch.paid > 0`)
    if (f.kind === 'overdue') conds.push(sql`COALESCE(od.overdue, 0) > 0`)
    if (f.kind === 'paid') conds.push(sql`ch.net - ch.paid <= 0`)
    conds.push(...amountRange(sql`(ch.net - ch.paid)`, f.min, f.max), ...searchLike(sql`s."searchText"`, f.q))
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      WITH ch AS (
        SELECT c."studentId", SUM(c."grossAmount") AS gross, SUM(c."discountAmount") AS disc, SUM(c."netAmount") AS net, SUM(c."paidAmount") AS paid
        FROM "charges" c WHERE c."status" = 'ACTIVE' ${y ? sql`AND c."academicYearId" = ${y}` : empty}
        GROUP BY c."studentId"
      ), od AS (
        SELECT i."studentId", SUM(i."amount" - i."paidAmount") AS overdue
        FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
        WHERE c."status" = 'ACTIVE' AND i."status" IN ('UNPAID', 'PARTIAL') AND i."dueDate" < ${dt(overdueBefore(env))}
          ${y ? sql`AND i."academicYearId" = ${y}` : empty}
        GROUP BY i."studentId"
      ), cr AS (
        SELECT pa."studentId", SUM(pa."amount") AS credit
        FROM "payment_allocations" pa JOIN "receipts" r ON r."id" = pa."receiptId"
        WHERE pa."installmentId" IS NULL AND pa."refundVoucherId" IS NULL AND r."status" = 'ACTIVE'
        GROUP BY pa."studentId"
      )
      SELECT s."id", s."studentNumber", s."fullName", s."status"::text AS status, g."name" AS guardian, g."phone",
             en."gradeName", en."sectionName",
             ch.gross::text AS gross, ch.disc::text AS disc, ch.net::text AS net, ch.paid::text AS paid,
             (ch.net - ch.paid)::text AS remaining, COALESCE(od.overdue, 0)::text AS overdue, COALESCE(cr.credit, 0)::text AS credit
      FROM ch
      JOIN "students" s ON s."id" = ch."studentId"
      LEFT JOIN "guardians" g ON g."id" = s."guardianId"
      ${enrollmentLateral(y)}
      LEFT JOIN od ON od."studentId" = s."id"
      LEFT JOIN cr ON cr."studentId" = s."id"
      WHERE ${andAll(conds)}
      ORDER BY en."gradeSort" NULLS LAST, en."gradeName", s."fullName"`
    const out: Row[] = rows.map((r) => ({
      _studentId: n(r.id),
      number: String(r.studentNumber),
      name: String(r.fullName),
      grade: gradeLabel(r.gradeName, r.sectionName),
      guardian: (r.guardian as string) ?? '—',
      phone: (r.phone as string) ?? '',
      status: STUDENT_STATUS[String(r.status)]?.label ?? String(r.status),
      gross: m(r.gross),
      discount: m(r.disc),
      net: m(r.net),
      paid: m(r.paid),
      remaining: m(r.remaining),
      overdue: m(r.overdue),
      credit: m(r.credit),
    }))
    const moneyKeys = ['gross', 'discount', 'net', 'paid', 'remaining', 'overdue', 'credit']
    const totals = totalsOf(out, moneyKeys, { key: 'name', text: `الإجمالي (${out.length} طالب)` })
    return {
      columns: [
        { key: 'number', header: 'رقم الطالب', width: 12 },
        { key: 'name', header: 'اسم الطالب', width: 28, href: studentHref },
        { key: 'grade', header: 'الصف', width: 18 },
        { key: 'guardian', header: 'ولي الأمر', width: 22 },
        { key: 'phone', header: 'الهاتف', width: 15 },
        { key: 'status', header: 'الحالة', width: 10 },
        { key: 'gross', header: 'إجمالي الذمم', type: 'money' },
        { key: 'discount', header: 'الخصومات', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المدفوع', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'overdue', header: 'منه متأخر', type: 'money' },
        { key: 'credit', header: 'رصيد دائن', type: 'money' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'عدد الطلاب', value: out.length, type: 'number' },
        { label: 'صافي الذمم', value: totals.net, type: 'money' },
        { label: 'المدفوع', value: totals.paid, type: 'money' },
        { label: 'المتبقي', value: totals.remaining, type: 'money' },
        { label: 'منه متأخر', value: totals.overdue, type: 'money' },
        { label: 'نسبة التحصيل', value: D(String(totals.net)).isZero() ? null : D(String(totals.paid)).dividedBy(D(String(totals.net))).times(100).toDecimalPlaces(1).toNumber(), type: 'percent' },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 2. الطلاب المتأخرون
// ---------------------------------------------------------------------

export const lateStudents: ReportDef = {
  id: 'late-students',
  title: 'تقرير الطلاب المتأخرين',
  description: 'الطلاب الذين عليهم أقساط تجاوزت موعد استحقاقها، مرتبين حسب المبلغ المتأخر.',
  group: 'students',
  permissions: ['charges.view'],
  landscape: true,
  filters: [
    { key: 'year', allowAllYears: true },
    { key: 'grade' },
    { key: 'student' },
    {
      key: 'kind',
      label: 'مدة التأخير',
      options: [
        { value: '7', label: 'أكثر من أسبوع' },
        { value: '30', label: 'أكثر من شهر' },
        { value: '60', label: 'أكثر من شهرين' },
        { value: '90', label: 'أكثر من 3 أشهر' },
      ],
      allLabel: 'أي تأخير',
    },
    { key: 'amount', label: 'المبلغ المتأخر' },
    { key: 'q' },
  ],
  async run(f, env) {
    const y = f.yearId
    const conds: Prisma.Sql[] = [
      sql`c."status" = 'ACTIVE'`,
      sql`i."status" IN ('UNPAID', 'PARTIAL')`,
      sql`i."dueDate" < ${dt(overdueBefore(env))}`,
    ]
    if (y) conds.push(sql`i."academicYearId" = ${y}`)
    if (f.gradeId) conds.push(sql`en."gradeId" = ${f.gradeId}`)
    if (f.studentId) conds.push(sql`s."id" = ${f.studentId}`)
    conds.push(...searchLike(sql`s."searchText"`, f.q))
    const having: Prisma.Sql[] = [...amountRange(sql`SUM(i."amount" - i."paidAmount")`, f.min, f.max)]
    if (f.kind) having.push(sql`MIN(i."dueDate") <= ${dt(addDays(env.today, -Number(f.kind)))}`)
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT s."id", s."studentNumber", s."fullName", g."name" AS guardian, g."phone", en."gradeName", en."sectionName",
             COUNT(i."id") AS cnt, MIN(i."dueDate") AS oldest, SUM(i."amount" - i."paidAmount")::text AS overdue,
             (SELECT COALESCE(SUM(c2."netAmount" - c2."paidAmount"), 0) FROM "charges" c2 WHERE c2."studentId" = s."id" AND c2."status" = 'ACTIVE')::text AS remaining
      FROM "installments" i
      JOIN "charges" c ON c."id" = i."chargeId"
      JOIN "students" s ON s."id" = i."studentId"
      LEFT JOIN "guardians" g ON g."id" = s."guardianId"
      ${enrollmentLateral(y)}
      WHERE ${andAll(conds)}
      GROUP BY s."id", g."id", en."gradeName", en."sectionName", en."gradeId"
      ${having.length ? sql`HAVING ${Prisma.join(having, ' AND ')}` : empty}
      ORDER BY SUM(i."amount" - i."paidAmount") DESC, s."fullName"`
    const out: Row[] = rows.map((r) => {
      const oldest = d(r.oldest as Date)
      return {
        _studentId: n(r.id),
        number: String(r.studentNumber),
        name: String(r.fullName),
        grade: gradeLabel(r.gradeName, r.sectionName),
        guardian: (r.guardian as string) ?? '—',
        phone: (r.phone as string) ?? '',
        count: n(r.cnt),
        oldest,
        days: oldest ? diffDays(env.today, oldest) : null,
        overdue: m(r.overdue),
        remaining: m(r.remaining),
      }
    })
    const totals = totalsOf(out, ['overdue', 'remaining'], { key: 'name', text: `الإجمالي (${out.length} طالب)` })
    return {
      columns: [
        { key: 'number', header: 'رقم الطالب', width: 12 },
        { key: 'name', header: 'اسم الطالب', width: 28, href: studentHref },
        { key: 'grade', header: 'الصف', width: 18 },
        { key: 'guardian', header: 'ولي الأمر', width: 22 },
        { key: 'phone', header: 'الهاتف', width: 15 },
        { key: 'count', header: 'أقساط متأخرة', type: 'number', width: 12 },
        { key: 'oldest', header: 'أقدم استحقاق', type: 'date' },
        { key: 'days', header: 'أيام التأخير', type: 'number', width: 12 },
        { key: 'overdue', header: 'المبلغ المتأخر', type: 'money' },
        { key: 'remaining', header: 'إجمالي المتبقي', type: 'money' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'عدد الطلاب المتأخرين', value: out.length, type: 'number' },
        { label: 'إجمالي المتأخرات', value: totals.overdue, type: 'money' },
        { label: 'إجمالي المتبقي عليهم', value: totals.remaining, type: 'money' },
      ],
      note: env.settings.finance.graceDays ? `يُعتبر القسط متأخرًا بعد ${env.settings.finance.graceDays} يوم من استحقاقه (فترة السماح).` : undefined,
    }
  },
}

// ---------------------------------------------------------------------
// 3 – 6. الأقساط المستحقة (اليوم، الأسبوع، الشهر) والمتأخرة
// ---------------------------------------------------------------------

async function installmentRows(f: ReportFilters, env: ReportEnv, mode: 'due' | 'overdue') {
  const conds: Prisma.Sql[] = [sql`c."status" = 'ACTIVE'`, sql`i."status" IN ('UNPAID', 'PARTIAL')`]
  if (mode === 'due') conds.push(...dateRange(sql`i."dueDate"`, f.from, f.to))
  else conds.push(sql`i."dueDate" < ${dt(overdueBefore(env))}`)
  if (f.yearId) conds.push(sql`i."academicYearId" = ${f.yearId}`)
  if (f.gradeId) conds.push(sql`e."gradeId" = ${f.gradeId}`)
  if (f.studentId) conds.push(sql`s."id" = ${f.studentId}`)
  if (f.chargeTypeId) conds.push(sql`c."chargeTypeId" = ${f.chargeTypeId}`)
  conds.push(...amountRange(sql`(i."amount" - i."paidAmount")`, f.min, f.max), ...searchLike(sql`s."searchText"`, f.q))
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT i."id", i."dueDate", i."number", c."installmentCount", i."amount"::text AS amount, i."paidAmount"::text AS paid,
           (i."amount" - i."paidAmount")::text AS remaining, c."id" AS "chargeId", c."description",
           s."id" AS "studentId", s."studentNumber", s."fullName", g."name" AS guardian, g."phone",
           gr."name" AS "gradeName", sec."name" AS "sectionName", ct."name" AS "chargeType"
    FROM "installments" i
    JOIN "charges" c ON c."id" = i."chargeId"
    JOIN "charge_types" ct ON ct."id" = c."chargeTypeId"
    JOIN "students" s ON s."id" = i."studentId"
    LEFT JOIN "guardians" g ON g."id" = s."guardianId"
    LEFT JOIN "enrollments" e ON e."studentId" = s."id" AND e."academicYearId" = i."academicYearId"
    LEFT JOIN "grades" gr ON gr."id" = e."gradeId"
    LEFT JOIN "sections" sec ON sec."id" = e."sectionId"
    WHERE ${andAll(conds)}
    ORDER BY i."dueDate" ASC, s."fullName" ASC, i."number" ASC
    LIMIT 20000`
  const out: Row[] = rows.map((r) => {
    const due = d(r.dueDate as Date)
    return {
      _studentId: n(r.studentId),
      _chargeId: n(r.chargeId),
      number: String(r.studentNumber),
      name: String(r.fullName),
      grade: gradeLabel(r.gradeName, r.sectionName),
      guardian: (r.guardian as string) ?? '—',
      phone: (r.phone as string) ?? '',
      chargeType: `${r.chargeType}${r.description ? ` — ${r.description}` : ''}`,
      installment: n(r.installmentCount) > 1 ? `${n(r.number)} من ${n(r.installmentCount)}` : 'دفعة واحدة',
      dueDate: due,
      days: mode === 'overdue' && due ? diffDays(env.today, due) : null,
      amount: m(r.amount),
      paid: m(r.paid),
      remaining: m(r.remaining),
    }
  })
  const totals = totalsOf(out, ['amount', 'paid', 'remaining'], { key: 'name', text: `الإجمالي (${out.length} قسط)` })
  const students = new Set(out.map((r) => r._studentId)).size
  return {
    columns: [
      { key: 'number', header: 'رقم الطالب', width: 12 },
      { key: 'name', header: 'اسم الطالب', width: 26, href: studentHref },
      { key: 'grade', header: 'الصف', width: 16 },
      { key: 'guardian', header: 'ولي الأمر', width: 20 },
      { key: 'phone', header: 'الهاتف', width: 14 },
      { key: 'chargeType', header: 'الذمة', width: 22, href: (r: Row) => (r._chargeId ? `/charges/${r._chargeId}` : null) },
      { key: 'installment', header: 'القسط', width: 12 },
      { key: 'dueDate', header: 'الاستحقاق', type: 'date' as const },
      ...(mode === 'overdue' ? [{ key: 'days', header: 'أيام التأخير', type: 'number' as const, width: 11 }] : []),
      { key: 'amount', header: 'مبلغ القسط', type: 'money' as const },
      { key: 'paid', header: 'المدفوع', type: 'money' as const },
      { key: 'remaining', header: 'المتبقي', type: 'money' as const },
    ],
    rows: out,
    totals,
    summary: [
      { label: 'عدد الأقساط', value: out.length, type: 'number' as const },
      { label: 'عدد الطلاب', value: students, type: 'number' as const },
      { label: mode === 'overdue' ? 'إجمالي المتأخر' : 'إجمالي المستحق', value: totals.remaining, type: 'money' as const },
    ],
  }
}

const dueFilters = (period: 'today' | 'week' | 'month'): ReportDef['filters'] => [
  { key: 'period', defaultPeriod: period },
  { key: 'grade' },
  { key: 'chargeType' },
  { key: 'student' },
  { key: 'amount', label: 'المتبقي' },
  { key: 'q' },
]

export const dueToday: ReportDef = {
  id: 'due-today',
  title: 'تقرير الأقساط المستحقة اليوم',
  description: 'الأقساط غير المسددة التي يحل موعدها اليوم مع هواتف أولياء الأمور للتذكير.',
  group: 'students',
  permissions: ['charges.view'],
  landscape: true,
  filters: dueFilters('today'),
  run: (f, env) => installmentRows(f, env, 'due'),
}

export const dueWeek: ReportDef = {
  ...dueToday,
  id: 'due-week',
  title: 'تقرير الأقساط المستحقة هذا الأسبوع',
  description: 'الأقساط غير المسددة المستحقة خلال الأسبوع الحالي.',
  filters: dueFilters('week'),
}

export const dueMonth: ReportDef = {
  ...dueToday,
  id: 'due-month',
  title: 'تقرير الأقساط المستحقة هذا الشهر',
  description: 'الأقساط غير المسددة المستحقة خلال الشهر الحالي.',
  filters: dueFilters('month'),
}

export const overdueInstallments: ReportDef = {
  id: 'overdue-installments',
  title: 'تقرير الأقساط المتأخرة',
  description: 'كل قسط تجاوز موعد استحقاقه ولم يُسدد بالكامل، مع عدد أيام التأخير.',
  group: 'students',
  permissions: ['charges.view'],
  landscape: true,
  filters: [{ key: 'year', allowAllYears: true }, { key: 'grade' }, { key: 'chargeType' }, { key: 'student' }, { key: 'amount', label: 'المتبقي' }, { key: 'q' }],
  run: (f, env) => installmentRows(f, env, 'overdue'),
}

// ---------------------------------------------------------------------
// 7. التحصيل
// ---------------------------------------------------------------------

export const collections: ReportDef = {
  id: 'collections',
  title: 'تقرير التحصيل',
  description: 'المبالغ المحصلة من الطلاب والعائلات حسب الفترة، مع التوزيع حسب طريقة الدفع والمستخدم.',
  group: 'students',
  permissions: ['receipts.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'month' },
    { key: 'grade' },
    { key: 'student' },
    { key: 'method' },
    { key: 'account' },
    { key: 'user' },
    { key: 'amount' },
    { key: 'status', options: [{ value: 'ACTIVE', label: 'فعالة' }, { value: 'CANCELLED', label: 'ملغاة' }], defaultValue: 'ACTIVE', allLabel: 'الكل' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [sql`r."kind" IN ('STUDENT', 'FAMILY')`, ...dateRange(sql`r."date"`, f.from, f.to)]
    if (f.status) conds.push(sql`r."status"::text = ${f.status}`)
    if (f.method) conds.push(sql`r."paymentMethod"::text = ${f.method}`)
    if (f.userId) conds.push(sql`r."createdById" = ${f.userId}`)
    if (f.accountId) conds.push(sql`r."cashAccountId" = ${f.accountId}`)
    conds.push(...amountRange(sql`r."amount"`, f.min, f.max))
    if (f.studentId || f.gradeId) {
      conds.push(sql`EXISTS (
        SELECT 1 FROM "payment_allocations" pa
        LEFT JOIN "enrollments" e ON e."studentId" = pa."studentId" AND e."academicYearId" = r."academicYearId"
        WHERE pa."receiptId" = r."id" ${f.studentId ? sql`AND pa."studentId" = ${f.studentId}` : empty} ${f.gradeId ? sql`AND e."gradeId" = ${f.gradeId}` : empty})`)
    }
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT r."id", r."number", r."date", r."kind"::text AS kind, r."payerName", r."amount"::text AS amount, r."paymentMethod"::text AS method,
             r."status"::text AS status, s."id" AS "studentId", s."fullName" AS "studentName", gu."id" AS "guardianId", gu."name" AS "guardianName",
             ca."name" AS "accountName", u."fullName" AS "userName", ch."number" AS "chequeNumber"
      FROM "receipts" r
      LEFT JOIN "students" s ON s."id" = r."studentId"
      LEFT JOIN "guardians" gu ON gu."id" = r."guardianId"
      LEFT JOIN "cash_accounts" ca ON ca."id" = r."cashAccountId"
      LEFT JOIN "users" u ON u."id" = r."createdById"
      LEFT JOIN "cheques" ch ON ch."receiptId" = r."id"
      WHERE ${andAll(conds)}
      ORDER BY r."date" DESC, r."id" DESC`
    const out: Row[] = rows.map((r) => ({
      _receiptId: n(r.id),
      _studentId: r.studentId ? n(r.studentId) : null,
      date: d(r.date as Date),
      number: String(r.number),
      payer: String(r.payerName),
      who: r.studentName ? String(r.studentName) : r.guardianName ? `عائلة ${r.guardianName}` : '—',
      method: `${PAYMENT_METHOD[String(r.method)] ?? r.method}${r.chequeNumber ? ` (${r.chequeNumber})` : ''}`,
      account: (r.accountName as string) ?? (r.chequeNumber ? 'حافظة الشيكات' : '—'),
      amount: m(r.amount),
      user: (r.userName as string) ?? '—',
      status: DOC_STATUS[String(r.status)]?.label ?? String(r.status),
    }))
    const active = rows.filter((r) => r.status === 'ACTIVE')
    const total = sum(active.map((r) => String(r.amount)))
    const group = (key: (r: Record<string, unknown>) => string) => {
      const map = new Map<string, { count: number; amount: ReturnType<typeof D> }>()
      for (const r of active) {
        const k = key(r)
        const g = map.get(k) ?? { count: 0, amount: D(0) }
        g.count++
        g.amount = g.amount.plus(D(String(r.amount)))
        map.set(k, g)
      }
      return [...map.entries()].sort((a, b) => b[1].amount.comparedTo(a[1].amount)).map(([label, g]) => ({ label, count: g.count, amount: g.amount.toString() }))
    }
    const breakdownCols = [
      { key: 'label', header: 'البند', width: 24 },
      { key: 'count', header: 'عدد السندات', type: 'number' as const },
      { key: 'amount', header: 'المبلغ', type: 'money' as const },
    ]
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'number', header: 'رقم السند', width: 18, href: (r) => `/receipts/${r._receiptId}` },
        { key: 'payer', header: 'الدافع', width: 22 },
        { key: 'who', header: 'الطالب / العائلة', width: 24, href: studentHref },
        { key: 'method', header: 'طريقة الدفع', width: 16 },
        { key: 'account', header: 'الصندوق / البنك', width: 18 },
        { key: 'amount', header: 'المبلغ', type: 'money' },
        { key: 'user', header: 'المستخدم', width: 16 },
        { key: 'status', header: 'الحالة', width: 9 },
      ],
      rows: out,
      totals: { payer: `الإجمالي (${active.length} سند فعال)`, amount: total.toString() },
      summary: [
        { label: 'إجمالي المحصل', value: total.toString(), type: 'money' },
        { label: 'عدد السندات', value: active.length, type: 'number' },
        { label: 'متوسط السند', value: active.length ? total.dividedBy(active.length).toDecimalPlaces(2).toString() : '0', type: 'money' },
      ],
      breakdowns: [
        { title: 'حسب طريقة الدفع', columns: breakdownCols, rows: group((r) => PAYMENT_METHOD[String(r.method)] ?? String(r.method)) },
        { title: 'حسب المستخدم', columns: breakdownCols, rows: group((r) => (r.userName as string) ?? '—') },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 8. الخصومات
// ---------------------------------------------------------------------

export const discounts: ReportDef = {
  id: 'discounts',
  title: 'تقرير الخصومات',
  description: 'كل خصم: الطالب، النوع، الطريقة والقيمة، المبلغ قبل وبعد، السبب، ومن وافق عليه.',
  group: 'students',
  permissions: ['charges.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'year', allowAllYears: true },
    { key: 'grade' },
    { key: 'student' },
    {
      key: 'kind',
      label: 'نوع الخصم',
      loadOptions: async () => (await db.discountType.findMany({ orderBy: { sortOrder: 'asc' } })).map((t) => ({ value: String(t.id), label: t.name })),
    },
    { key: 'user' },
    { key: 'amount', label: 'مبلغ الخصم' },
    { key: 'status', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'CANCELLED', label: 'ملغي' }], defaultValue: 'ACTIVE', allLabel: 'الكل' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [...dateRange(sql`dc."date"`, f.from, f.to)]
    if (f.yearId) conds.push(sql`dc."academicYearId" = ${f.yearId}`)
    if (f.gradeId) conds.push(sql`e."gradeId" = ${f.gradeId}`)
    if (f.studentId) conds.push(sql`dc."studentId" = ${f.studentId}`)
    if (f.kind) conds.push(sql`dc."discountTypeId" = ${Number(f.kind)}`)
    if (f.userId) conds.push(sql`dc."createdById" = ${f.userId}`)
    if (f.status) conds.push(sql`dc."status"::text = ${f.status}`)
    conds.push(...amountRange(sql`dc."amount"`, f.min, f.max))
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT dc."id", dc."date", dc."method"::text AS method, dc."value"::text AS value, dc."scope"::text AS scope,
             dc."baseAmount"::text AS base, dc."amount"::text AS amount, dc."netAmount"::text AS net, dc."reason", dc."approvedBy",
             dc."status"::text AS status, s."id" AS "studentId", s."fullName", s."studentNumber", dt."name" AS "typeName",
             ct."name" AS "chargeTypeName", ct2."name" AS "scopeTypeName", gr."name" AS "gradeName", u."fullName" AS "userName"
      FROM "discounts" dc
      JOIN "students" s ON s."id" = dc."studentId"
      LEFT JOIN "discount_types" dt ON dt."id" = dc."discountTypeId"
      LEFT JOIN "charges" c ON c."id" = dc."chargeId"
      LEFT JOIN "charge_types" ct ON ct."id" = c."chargeTypeId"
      LEFT JOIN "charge_types" ct2 ON ct2."id" = dc."chargeTypeId"
      LEFT JOIN "enrollments" e ON e."studentId" = s."id" AND e."academicYearId" = dc."academicYearId"
      LEFT JOIN "grades" gr ON gr."id" = e."gradeId"
      LEFT JOIN "users" u ON u."id" = dc."createdById"
      WHERE ${andAll(conds)}
      ORDER BY dc."date" DESC, dc."id" DESC`
    const out: Row[] = rows.map((r) => ({
      _studentId: n(r.studentId),
      date: d(r.date as Date),
      name: String(r.fullName),
      grade: (r.gradeName as string) ?? '—',
      type: (r.typeName as string) ?? '—',
      method: DISCOUNT_METHOD[String(r.method)] ?? String(r.method),
      value: r.method === 'PERCENT' ? `${D(String(r.value)).toString()}%` : m(r.value),
      scope: `${DISCOUNT_SCOPE[String(r.scope)] ?? r.scope}${r.chargeTypeName ? `: ${r.chargeTypeName}` : r.scopeTypeName ? `: ${r.scopeTypeName}` : ''}`,
      base: m(r.base),
      amount: m(r.amount),
      net: m(r.net),
      reason: String(r.reason ?? ''),
      approvedBy: (r.approvedBy as string) ?? '—',
      user: (r.userName as string) ?? '—',
      status: DOC_STATUS[String(r.status)]?.label ?? String(r.status),
    }))
    const active = out.filter((r, i) => rows[i].status === 'ACTIVE')
    const total = sum(active.map((r) => String(r.amount)))
    const byType = new Map<string, ReturnType<typeof D>>()
    for (const r of active) byType.set(String(r.type), (byType.get(String(r.type)) ?? D(0)).plus(D(String(r.amount))))
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'name', header: 'الطالب', width: 24, href: studentHref },
        { key: 'grade', header: 'الصف', width: 14 },
        { key: 'type', header: 'نوع الخصم', width: 16 },
        { key: 'method', header: 'الطريقة', width: 12 },
        { key: 'value', header: 'القيمة', width: 10 },
        { key: 'scope', header: 'على', width: 22 },
        { key: 'base', header: 'قبل الخصم', type: 'money' },
        { key: 'amount', header: 'مبلغ الخصم', type: 'money' },
        { key: 'net', header: 'بعد الخصم', type: 'money' },
        { key: 'reason', header: 'السبب', width: 24 },
        { key: 'approvedBy', header: 'الموافقة', width: 14 },
        { key: 'user', header: 'المستخدم', width: 14 },
        { key: 'status', header: 'الحالة', width: 8 },
      ],
      rows: out,
      totals: { name: `الإجمالي (${active.length} خصم فعال)`, amount: total.toString() },
      summary: [
        { label: 'إجمالي الخصومات', value: total.toString(), type: 'money' },
        { label: 'عدد الخصومات', value: active.length, type: 'number' },
        { label: 'عدد الطلاب', value: new Set(active.map((r) => r._studentId)).size, type: 'number' },
      ],
      breakdowns: [
        {
          title: 'حسب نوع الخصم',
          columns: [
            { key: 'label', header: 'النوع', width: 24 },
            { key: 'amount', header: 'المبلغ', type: 'money' },
          ],
          rows: [...byType.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([label, amount]) => ({ label, amount: amount.toString() })),
        },
      ],
    }
  },
}

export const RECEIPT_KIND_OPTIONS = Object.entries(RECEIPT_KIND).map(([value, label]) => ({ value, label }))
