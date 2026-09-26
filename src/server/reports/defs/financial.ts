import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '../../db'
import { D } from '@/lib/money'
import { addDays } from '@/lib/dates'
import { PAYMENT_STATUS, YEAR_STATUS } from '@/lib/labels'
import { amountRange, andAll, d, dt, empty, m, n, pct, searchLike, sql, totalsOf } from '../sql'
import type { ReportDef, Row } from '../types'

/** التقارير 20 – 23: مالي حسب السنة الدراسية، الصف، الطالب، ونوع الذمة. */

const rateOf = (paid: unknown, net: unknown) => pct(paid, net)

// ---------------------------------------------------------------------
// 20. حسب السنة الدراسية
// ---------------------------------------------------------------------

export const byYear: ReportDef = {
  id: 'by-year',
  title: 'تقرير مالي حسب السنة الدراسية',
  description: 'مقارنة السنوات: الطلاب، الذمم والخصومات والتحصيل، والإيرادات والمصروفات وصافي الربح لكل سنة.',
  group: 'financial',
  permissions: ['reports.financial', 'charges.view'],
  landscape: true,
  filters: [{ key: 'year', allowAllYears: true, defaultAll: true }],
  async run(f) {
    const cond = f.yearId ? sql`ay."id" = ${f.yearId}` : sql`TRUE`
    const [rows, ledger, cash] = await Promise.all([
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT ay."id", ay."name", ay."status"::text AS status, ay."startDate", ay."endDate",
               (SELECT COUNT(*) FROM "enrollments" e WHERE e."academicYearId" = ay."id") AS students,
               COALESCE(SUM(c."grossAmount"), 0)::text AS gross, COALESCE(SUM(c."discountAmount"), 0)::text AS disc,
               COALESCE(SUM(c."netAmount"), 0)::text AS net, COALESCE(SUM(c."paidAmount"), 0)::text AS paid
        FROM "academic_years" ay
        LEFT JOIN "charges" c ON c."academicYearId" = ay."id" AND c."status" = 'ACTIVE'
        WHERE ${cond}
        GROUP BY ay."id"
        ORDER BY ay."startDate" DESC`,
      db.$queryRaw<{ id: number; revenue: string; expense: string }[]>`
        SELECT ay."id",
               COALESCE(SUM(CASE WHEN a."type" = 'REVENUE' THEN jl."credit" - jl."debit" END), 0)::text AS revenue,
               COALESCE(SUM(CASE WHEN a."type" = 'EXPENSE' THEN jl."debit" - jl."credit" END), 0)::text AS expense
        FROM "academic_years" ay
        JOIN "journal_lines" jl ON jl."date" BETWEEN ay."startDate" AND ay."endDate"
        JOIN "journal_entries" je ON je."id" = jl."entryId" AND je."sourceType" <> 'YEAR_CLOSE'
        JOIN "accounts" a ON a."id" = jl."accountId" AND a."type" IN ('REVENUE', 'EXPENSE')
        WHERE ${cond}
        GROUP BY ay."id"`,
      db.$queryRaw<{ id: number; collected: string }[]>`
        SELECT r."academicYearId" AS id, COALESCE(SUM(r."amount"), 0)::text AS collected
        FROM "receipts" r WHERE r."status" = 'ACTIVE' AND r."kind" IN ('STUDENT', 'FAMILY')
        GROUP BY r."academicYearId"`,
    ])
    const lmap = new Map(ledger.map((l) => [Number(l.id), l]))
    const cmap = new Map(cash.map((c) => [Number(c.id), c.collected]))
    const out: Row[] = rows.map((r) => {
      const l = lmap.get(n(r.id))
      const revenue = D(l?.revenue ?? 0)
      const expense = D(l?.expense ?? 0)
      return {
        name: String(r.name),
        status: YEAR_STATUS[String(r.status)]?.label ?? String(r.status),
        period: `${d(r.startDate as Date)} ← ${d(r.endDate as Date)}`,
        students: n(r.students),
        gross: m(r.gross),
        discount: m(r.disc),
        net: m(r.net),
        paid: m(r.paid),
        remaining: D(String(r.net)).minus(D(String(r.paid))).toString(),
        rate: rateOf(r.paid, r.net),
        collected: m(cmap.get(n(r.id)) ?? 0),
        revenue: revenue.toString(),
        expense: expense.toString(),
        profit: revenue.minus(expense).toString(),
      }
    })
    return {
      columns: [
        { key: 'name', header: 'السنة', width: 12 },
        { key: 'status', header: 'الحالة', width: 9 },
        { key: 'students', header: 'الطلاب', type: 'number', width: 9 },
        { key: 'gross', header: 'الذمم', type: 'money' },
        { key: 'discount', header: 'الخصومات', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المحصل من الذمم', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'rate', header: 'التحصيل %', type: 'percent' },
        { key: 'collected', header: 'سندات القبض', type: 'money' },
        { key: 'revenue', header: 'صافي الإيرادات', type: 'money' },
        { key: 'expense', header: 'المصروفات', type: 'money' },
        { key: 'profit', header: 'صافي الربح', type: 'money' },
      ],
      rows: out,
      note: 'الإيرادات والمصروفات وصافي الربح من الأستاذ العام ضمن تواريخ كل سنة (أساس الاستحقاق)؛ سندات القبض = التحصيل الفعلي المسجل على السنة.',
    }
  },
}

// ---------------------------------------------------------------------
// 21. حسب الصف
// ---------------------------------------------------------------------

export const byGrade: ReportDef = {
  id: 'by-grade',
  title: 'تقرير مالي حسب الصف',
  description: 'لكل صف في السنة: عدد الطلاب، الذمم، الخصومات، المحصل، المتبقي، المتأخر، ونسبة التحصيل.',
  group: 'financial',
  permissions: ['charges.view'],
  landscape: true,
  filters: [{ key: 'year' }, { key: 'grade' }, { key: 'chargeType' }],
  async run(f, env) {
    const y = f.yearId ?? -1
    const ct = f.chargeTypeId ? sql`AND c."chargeTypeId" = ${f.chargeTypeId}` : empty
    const overdueBefore = addDays(env.today, -env.settings.finance.graceDays)
    const [rows, overdue] = await Promise.all([
      db.$queryRaw<Record<string, unknown>[]>`
        SELECT g."id", g."name", g."sortOrder",
               (SELECT COUNT(*) FROM "enrollments" e2 WHERE e2."gradeId" = g."id" AND e2."academicYearId" = ${y}) AS students,
               COUNT(DISTINCT c."studentId") AS charged,
               COALESCE(SUM(c."grossAmount"), 0)::text AS gross, COALESCE(SUM(c."discountAmount"), 0)::text AS disc,
               COALESCE(SUM(c."netAmount"), 0)::text AS net, COALESCE(SUM(c."paidAmount"), 0)::text AS paid
        FROM "grades" g
        LEFT JOIN "enrollments" e ON e."gradeId" = g."id" AND e."academicYearId" = ${y}
        LEFT JOIN "charges" c ON c."studentId" = e."studentId" AND c."academicYearId" = ${y} AND c."status" = 'ACTIVE' ${ct}
        WHERE ${f.gradeId ? sql`g."id" = ${f.gradeId}` : sql`TRUE`}
        GROUP BY g."id"
        HAVING g."isActive" = true OR COUNT(c."id") > 0
        ORDER BY g."sortOrder", g."name"`,
      db.$queryRaw<{ gradeId: number; overdue: string }[]>`
        SELECT e."gradeId", COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS overdue
        FROM "installments" i
        JOIN "charges" c ON c."id" = i."chargeId"
        JOIN "enrollments" e ON e."studentId" = i."studentId" AND e."academicYearId" = i."academicYearId"
        WHERE i."academicYearId" = ${y} AND c."status" = 'ACTIVE' AND i."status" IN ('UNPAID', 'PARTIAL') AND i."dueDate" < ${dt(overdueBefore)} ${ct}
        GROUP BY e."gradeId"`,
    ])
    const omap = new Map(overdue.map((o) => [Number(o.gradeId), o.overdue]))
    const out: Row[] = rows.map((r) => ({
      name: String(r.name),
      students: n(r.students),
      charged: n(r.charged),
      gross: m(r.gross),
      discount: m(r.disc),
      net: m(r.net),
      paid: m(r.paid),
      remaining: D(String(r.net)).minus(D(String(r.paid))).toString(),
      overdue: m(omap.get(n(r.id)) ?? 0),
      rate: rateOf(r.paid, r.net),
    }))
    const totals = totalsOf(out, ['gross', 'discount', 'net', 'paid', 'remaining', 'overdue'], { key: 'name', text: 'الإجمالي' })
    totals.students = out.reduce((a, r) => a + Number(r.students), 0)
    totals.charged = out.reduce((a, r) => a + Number(r.charged), 0)
    totals.rate = rateOf(totals.paid, totals.net)
    return {
      columns: [
        { key: 'name', header: 'الصف', width: 18 },
        { key: 'students', header: 'المسجلون', type: 'number', width: 10 },
        { key: 'charged', header: 'عليهم ذمم', type: 'number', width: 10 },
        { key: 'gross', header: 'الذمم', type: 'money' },
        { key: 'discount', header: 'الخصومات', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المحصل', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'overdue', header: 'المتأخر', type: 'money' },
        { key: 'rate', header: 'التحصيل %', type: 'percent' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'صافي الذمم', value: totals.net, type: 'money' },
        { label: 'المحصل', value: totals.paid, type: 'money' },
        { label: 'المتبقي', value: totals.remaining, type: 'money' },
        { label: 'نسبة التحصيل', value: totals.rate, type: 'percent' },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 22. حسب الطالب
// ---------------------------------------------------------------------

export const byStudent: ReportDef = {
  id: 'by-student',
  title: 'تقرير مالي حسب الطالب',
  description: 'تفصيل ذمم كل طالب: نوع الذمة، المبلغ، الخصم، الصافي، المدفوع، والمتبقي.',
  group: 'financial',
  permissions: ['charges.view'],
  landscape: true,
  filters: [
    { key: 'year', allowAllYears: true },
    { key: 'grade' },
    { key: 'student' },
    { key: 'chargeType' },
    { key: 'status', label: 'حالة الدفع', options: Object.entries(PAYMENT_STATUS).map(([value, v]) => ({ value, label: v.label })) },
    { key: 'amount', label: 'المتبقي' },
    { key: 'q' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [sql`c."status" = 'ACTIVE'`]
    if (f.yearId) conds.push(sql`c."academicYearId" = ${f.yearId}`)
    if (f.gradeId) conds.push(sql`e."gradeId" = ${f.gradeId}`)
    if (f.studentId) conds.push(sql`c."studentId" = ${f.studentId}`)
    if (f.chargeTypeId) conds.push(sql`c."chargeTypeId" = ${f.chargeTypeId}`)
    if (f.status) conds.push(sql`c."paymentStatus"::text = ${f.status}`)
    conds.push(...amountRange(sql`(c."netAmount" - c."paidAmount")`, f.min, f.max), ...searchLike(sql`s."searchText"`, f.q))
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT c."id", c."date", c."description", c."installmentCount", c."grossAmount"::text AS gross, c."discountAmount"::text AS disc,
             c."netAmount"::text AS net, c."paidAmount"::text AS paid, (c."netAmount" - c."paidAmount")::text AS remaining, c."paymentStatus"::text AS status,
             s."id" AS "studentId", s."studentNumber", s."fullName", ct."name" AS "chargeType", ay."name" AS "yearName",
             gr."name" AS "gradeName", sec."name" AS "sectionName"
      FROM "charges" c
      JOIN "students" s ON s."id" = c."studentId"
      JOIN "charge_types" ct ON ct."id" = c."chargeTypeId"
      JOIN "academic_years" ay ON ay."id" = c."academicYearId"
      LEFT JOIN "enrollments" e ON e."studentId" = s."id" AND e."academicYearId" = c."academicYearId"
      LEFT JOIN "grades" gr ON gr."id" = e."gradeId"
      LEFT JOIN "sections" sec ON sec."id" = e."sectionId"
      WHERE ${andAll(conds)}
      ORDER BY gr."sortOrder" NULLS LAST, s."fullName", c."date", c."id"
      LIMIT 20000`
    const out: Row[] = rows.map((r) => ({
      _studentId: n(r.studentId),
      _chargeId: n(r.id),
      number: String(r.studentNumber),
      name: String(r.fullName),
      grade: r.gradeName ? `${r.gradeName}${r.sectionName ? ` - ${r.sectionName}` : ''}` : '—',
      year: String(r.yearName),
      chargeType: `${r.chargeType}${r.description ? ` — ${r.description}` : ''}`,
      installments: n(r.installmentCount),
      gross: m(r.gross),
      discount: m(r.disc),
      net: m(r.net),
      paid: m(r.paid),
      remaining: m(r.remaining),
      status: PAYMENT_STATUS[String(r.status)]?.label ?? String(r.status),
    }))
    const totals = totalsOf(out, ['gross', 'discount', 'net', 'paid', 'remaining'], { key: 'name', text: `الإجمالي (${out.length} ذمة)` })
    return {
      columns: [
        { key: 'number', header: 'رقم الطالب', width: 12 },
        { key: 'name', header: 'الطالب', width: 26, href: (r) => `/students/${r._studentId}` },
        { key: 'grade', header: 'الصف', width: 16 },
        { key: 'year', header: 'السنة', width: 10 },
        { key: 'chargeType', header: 'الذمة', width: 26, href: (r) => `/charges/${r._chargeId}` },
        { key: 'installments', header: 'الأقساط', type: 'number', width: 8 },
        { key: 'gross', header: 'المبلغ', type: 'money' },
        { key: 'discount', header: 'الخصم', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المدفوع', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'status', header: 'الحالة', width: 12 },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'عدد الطلاب', value: new Set(out.map((r) => r._studentId)).size, type: 'number' },
        { label: 'صافي الذمم', value: totals.net, type: 'money' },
        { label: 'المدفوع', value: totals.paid, type: 'money' },
        { label: 'المتبقي', value: totals.remaining, type: 'money' },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 23. حسب نوع الذمة
// ---------------------------------------------------------------------

export const byChargeType: ReportDef = {
  id: 'by-charge-type',
  title: 'تقرير مالي حسب نوع الذمة',
  description: 'لكل نوع ذمة (رسوم، أقساط، كتب، زي، باص...): العدد، الإجمالي، الخصومات، المحصل، المتبقي، ونسبة التحصيل.',
  group: 'financial',
  permissions: ['charges.view'],
  filters: [{ key: 'year', allowAllYears: true }, { key: 'grade' }],
  async run(f) {
    const joinCond: Prisma.Sql[] = [sql`c."chargeTypeId" = ct."id"`, sql`c."status" = 'ACTIVE'`]
    if (f.yearId) joinCond.push(sql`c."academicYearId" = ${f.yearId}`)
    if (f.gradeId) {
      joinCond.push(sql`EXISTS (SELECT 1 FROM "enrollments" e WHERE e."studentId" = c."studentId" AND e."academicYearId" = c."academicYearId" AND e."gradeId" = ${f.gradeId})`)
    }
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT ct."id", ct."name", COUNT(c."id") AS charges, COUNT(DISTINCT c."studentId") AS students,
             COALESCE(SUM(c."grossAmount"), 0)::text AS gross, COALESCE(SUM(c."discountAmount"), 0)::text AS disc,
             COALESCE(SUM(c."netAmount"), 0)::text AS net, COALESCE(SUM(c."paidAmount"), 0)::text AS paid
      FROM "charge_types" ct
      LEFT JOIN "charges" c ON ${andAll(joinCond)}
      GROUP BY ct."id"
      HAVING COUNT(c."id") > 0
      ORDER BY ct."sortOrder", ct."name"`
    const out: Row[] = rows.map((r) => ({
      name: String(r.name),
      charges: n(r.charges),
      students: n(r.students),
      gross: m(r.gross),
      discount: m(r.disc),
      net: m(r.net),
      paid: m(r.paid),
      remaining: D(String(r.net)).minus(D(String(r.paid))).toString(),
      rate: rateOf(r.paid, r.net),
    }))
    const totals = totalsOf(out, ['gross', 'discount', 'net', 'paid', 'remaining'], { key: 'name', text: 'الإجمالي' })
    totals.charges = out.reduce((a, r) => a + Number(r.charges), 0)
    totals.rate = rateOf(totals.paid, totals.net)
    return {
      columns: [
        { key: 'name', header: 'نوع الذمة', width: 22 },
        { key: 'charges', header: 'عدد الذمم', type: 'number', width: 10 },
        { key: 'students', header: 'الطلاب', type: 'number', width: 10 },
        { key: 'gross', header: 'الإجمالي', type: 'money' },
        { key: 'discount', header: 'الخصومات', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المحصل', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'rate', header: 'التحصيل %', type: 'percent' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'صافي الذمم', value: totals.net, type: 'money' },
        { label: 'المحصل', value: totals.paid, type: 'money' },
        { label: 'نسبة التحصيل', value: totals.rate, type: 'percent' },
      ],
    }
  },
}
