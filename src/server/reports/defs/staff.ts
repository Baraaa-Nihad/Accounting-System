import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '../../db'
import { canSeeSalaries } from '../../auth/guard'
import { accountIdByKey } from '../../ledger/accounts'
import { D, sum } from '@/lib/money'
import { ADVANCE_STATUS, EMPLOYEE_STATUS, PAYMENT_STATUS, SALARY_TYPE } from '@/lib/labels'
import { ARABIC_MONTHS, parts } from '@/lib/dates'
import { amountRange, andAll, d, dateRange, dt, empty, m, n, searchLike, sql, totalsOf } from '../sql'
import type { ReportDef, ReportColumn, Row } from '../types'

/** التقارير 13 – 16: الرواتب، السلف، الموظفون، الموردون. */

const employeeHref = (r: Row) => (r._employeeId ? `/employees/${r._employeeId}` : null)

// ---------------------------------------------------------------------
// 13. الرواتب
// ---------------------------------------------------------------------

export const payrollReport: ReportDef = {
  id: 'payroll',
  title: 'تقرير الرواتب',
  description: 'رواتب المسيرات المعتمدة لكل موظف وشهر: الإجمالي، الخصومات، السلف، الصافي، والمصروف والمتبقي.',
  group: 'staff',
  permissions: ['salaries.view', 'payroll.manage', 'payroll.pay'],
  salaries: true,
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'employee' },
    { key: 'kind', label: 'النوع', options: [{ value: 'teacher', label: 'معلمون' }, { value: 'staff', label: 'إداريون وخدمات' }] },
    { key: 'status', label: 'حالة الصرف', options: Object.entries(PAYMENT_STATUS).map(([value, v]) => ({ value, label: v.label })) },
    { key: 'amount', label: 'الصافي' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [sql`pr."status" = 'APPROVED'`]
    // الشهر داخل الفترة: من أول شهر البداية حتى آخر شهر النهاية
    if (f.from) {
      const p = parts(f.from)
      conds.push(sql`(pr."year" * 12 + pr."month") >= ${p.y * 12 + p.m}`)
    }
    if (f.to) {
      const p = parts(f.to)
      conds.push(sql`(pr."year" * 12 + pr."month") <= ${p.y * 12 + p.m}`)
    }
    if (f.employeeId) conds.push(sql`pi."employeeId" = ${f.employeeId}`)
    if (f.kind === 'teacher') conds.push(sql`e."isTeacher" = true`)
    if (f.kind === 'staff') conds.push(sql`e."isTeacher" = false`)
    if (f.status) conds.push(sql`pi."paymentStatus"::text = ${f.status}`)
    conds.push(...amountRange(sql`pi."netPay"`, f.min, f.max))
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT pi."id", pr."id" AS "runId", pr."year", pr."month", e."id" AS "employeeId", e."fullName", e."employeeNumber", e."jobTitle",
             pi."basicPay"::text AS basic, pi."overtimeAmount"::text AS overtime, (pi."bonuses" + pi."allowances")::text AS extras,
             pi."grossPay"::text AS gross, (pi."totalDeductions" - pi."advanceDeduction")::text AS deductions, pi."advanceDeduction"::text AS advance,
             pi."netPay"::text AS net, pi."paidAmount"::text AS paid, (pi."netPay" - pi."paidAmount")::text AS remaining, pi."paymentStatus"::text AS status
      FROM "payroll_items" pi
      JOIN "payroll_runs" pr ON pr."id" = pi."payrollRunId"
      JOIN "employees" e ON e."id" = pi."employeeId"
      WHERE ${andAll(conds)}
      ORDER BY pr."year" DESC, pr."month" DESC, e."isTeacher" DESC, e."fullName"`
    const out: Row[] = rows.map((r) => ({
      _employeeId: n(r.employeeId),
      _runId: n(r.runId),
      _itemId: n(r.id),
      month: `${ARABIC_MONTHS[n(r.month) - 1]} ${n(r.year)}`,
      name: String(r.fullName),
      number: String(r.employeeNumber),
      basic: m(r.basic),
      overtime: m(r.overtime),
      extras: m(r.extras),
      gross: m(r.gross),
      deductions: m(r.deductions),
      advance: m(r.advance),
      net: m(r.net),
      paid: m(r.paid),
      remaining: m(r.remaining),
      status: PAYMENT_STATUS[String(r.status)]?.label ?? String(r.status),
    }))
    const keys = ['basic', 'overtime', 'extras', 'gross', 'deductions', 'advance', 'net', 'paid', 'remaining']
    const totals = totalsOf(out, keys, { key: 'name', text: `الإجمالي (${out.length} بند)` })
    // حسب الشهر
    const byMonth = new Map<string, { gross: ReturnType<typeof D>; net: ReturnType<typeof D>; paid: ReturnType<typeof D>; count: number }>()
    for (const r of out) {
      const g = byMonth.get(String(r.month)) ?? { gross: D(0), net: D(0), paid: D(0), count: 0 }
      g.gross = g.gross.plus(D(String(r.gross)))
      g.net = g.net.plus(D(String(r.net)))
      g.paid = g.paid.plus(D(String(r.paid)))
      g.count++
      byMonth.set(String(r.month), g)
    }
    return {
      columns: [
        { key: 'month', header: 'الشهر', width: 14, href: (r) => `/payroll/${r._runId}` },
        { key: 'name', header: 'الموظف', width: 24, href: employeeHref },
        { key: 'number', header: 'الرقم', width: 10 },
        { key: 'basic', header: 'الأساسي', type: 'money' },
        { key: 'overtime', header: 'الإضافي', type: 'money' },
        { key: 'extras', header: 'مكافآت وبدلات', type: 'money' },
        { key: 'gross', header: 'الإجمالي', type: 'money' },
        { key: 'deductions', header: 'الخصومات', type: 'money' },
        { key: 'advance', header: 'قسط السلفة', type: 'money' },
        { key: 'net', header: 'الصافي', type: 'money' },
        { key: 'paid', header: 'المصروف', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'status', header: 'الصرف', width: 12 },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'إجمالي الرواتب', value: totals.gross, type: 'money' },
        { label: 'صافي الرواتب', value: totals.net, type: 'money' },
        { label: 'المصروف', value: totals.paid, type: 'money' },
        { label: 'المتبقي للصرف', value: totals.remaining, type: 'money' },
      ],
      breakdowns: [
        {
          title: 'حسب الشهر',
          columns: [
            { key: 'label', header: 'الشهر', width: 16 },
            { key: 'count', header: 'الموظفون', type: 'number' },
            { key: 'gross', header: 'الإجمالي', type: 'money' },
            { key: 'net', header: 'الصافي', type: 'money' },
            { key: 'paid', header: 'المصروف', type: 'money' },
          ],
          rows: [...byMonth.entries()].map(([label, g]) => ({ label, count: g.count, gross: g.gross.toString(), net: g.net.toString(), paid: g.paid.toString() })),
        },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 14. السلف
// ---------------------------------------------------------------------

export const advancesReport: ReportDef = {
  id: 'advances',
  title: 'تقرير السلف',
  description: 'سلف الموظفين: المبلغ، القسط الشهري، المخصوم من الرواتب، والمتبقي.',
  group: 'staff',
  permissions: ['salaries.view', 'payroll.manage', 'advances.manage'],
  salaries: true,
  filters: [
    { key: 'period', defaultPeriod: 'all' },
    { key: 'employee' },
    { key: 'status', options: Object.entries(ADVANCE_STATUS).map(([value, v]) => ({ value, label: v.label })), defaultValue: 'ACTIVE', allLabel: 'الكل' },
    { key: 'amount' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [...dateRange(sql`a."date"`, f.from, f.to), ...amountRange(sql`a."amount"`, f.min, f.max)]
    if (f.employeeId) conds.push(sql`a."employeeId" = ${f.employeeId}`)
    if (f.status) conds.push(sql`a."status"::text = ${f.status}`)
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT a."id", a."date", a."amount"::text AS amount, a."installmentsCount", a."monthlyDeduction"::text AS monthly, a."startYear", a."startMonth",
             a."deductedAmount"::text AS deducted, (a."amount" - a."deductedAmount")::text AS remaining, a."status"::text AS status, a."reason",
             e."id" AS "employeeId", e."fullName", v."id" AS "voucherId", v."number" AS "voucherNumber"
      FROM "employee_advances" a
      JOIN "employees" e ON e."id" = a."employeeId"
      LEFT JOIN "payment_vouchers" v ON v."advanceId" = a."id"
      WHERE ${andAll(conds)}
      ORDER BY a."date" DESC, a."id" DESC`
    const out: Row[] = rows.map((r) => ({
      _employeeId: n(r.employeeId),
      _voucherId: r.voucherId ? n(r.voucherId) : null,
      date: d(r.date as Date),
      name: String(r.fullName),
      reason: (r.reason as string) ?? '',
      amount: m(r.amount),
      installments: n(r.installmentsCount),
      monthly: m(r.monthly),
      start: `${n(r.startMonth)}/${n(r.startYear)}`,
      deducted: m(r.deducted),
      remaining: r.status === 'CANCELLED' ? '0' : m(r.remaining),
      voucher: (r.voucherNumber as string) ?? '—',
      status: ADVANCE_STATUS[String(r.status)]?.label ?? String(r.status),
    }))
    const totals = totalsOf(out, ['amount', 'deducted', 'remaining'], { key: 'name', text: `الإجمالي (${out.length} سلفة)` })
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'name', header: 'الموظف', width: 24, href: employeeHref },
        { key: 'reason', header: 'السبب', width: 22 },
        { key: 'amount', header: 'المبلغ', type: 'money' },
        { key: 'installments', header: 'الأقساط', type: 'number', width: 9 },
        { key: 'monthly', header: 'القسط الشهري', type: 'money' },
        { key: 'start', header: 'يبدأ من', width: 10 },
        { key: 'deducted', header: 'المخصوم', type: 'money' },
        { key: 'remaining', header: 'المتبقي', type: 'money' },
        { key: 'voucher', header: 'السند', width: 16, href: (r) => (r._voucherId ? `/vouchers/${r._voucherId}` : null) },
        { key: 'status', header: 'الحالة', width: 10 },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'إجمالي السلف', value: totals.amount, type: 'money' },
        { label: 'المخصوم من الرواتب', value: totals.deducted, type: 'money' },
        { label: 'المتبقي على الموظفين', value: totals.remaining, type: 'money' },
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 15. الموظفون
// ---------------------------------------------------------------------

export const employeesReport: ReportDef = {
  id: 'employees',
  title: 'تقرير الموظفين',
  description: 'بيانات الموظفين والمعلمات، مع الرواتب والمستحق والسلف والمصروف لهم في الفترة (لمن يملك صلاحية الرواتب).',
  group: 'staff',
  permissions: ['employees.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'kind', label: 'النوع', options: [{ value: 'teacher', label: 'معلمون' }, { value: 'staff', label: 'إداريون وخدمات' }] },
    { key: 'status', options: Object.entries(EMPLOYEE_STATUS).map(([value, v]) => ({ value, label: v.label })), defaultValue: 'ACTIVE', allLabel: 'الكل' },
    { key: 'q' },
  ],
  async run(f, env) {
    const salaries = canSeeSalaries(env.user)
    const conds: Prisma.Sql[] = [...searchLike(sql`e."searchText"`, f.q)]
    if (f.status) conds.push(sql`e."status"::text = ${f.status}`)
    if (f.kind === 'teacher') conds.push(sql`e."isTeacher" = true`)
    if (f.kind === 'staff') conds.push(sql`e."isTeacher" = false`)
    const [payable, advances] = await Promise.all([accountIdByKey(db, 'SALARIES_PAYABLE'), accountIdByKey(db, 'EMPLOYEE_ADVANCES')])
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT e."id", e."employeeNumber", e."fullName", e."jobTitle", e."department", e."isTeacher", e."salaryType"::text AS "salaryType",
             e."baseSalary"::text AS salary, e."hireDate", e."status"::text AS status, e."phone",
             COALESCE((SELECT SUM(jl."credit" - jl."debit") FROM "journal_lines" jl WHERE jl."employeeId" = e."id" AND jl."accountId" = ${payable}), 0)::text AS due,
             COALESCE((SELECT SUM(jl."debit" - jl."credit") FROM "journal_lines" jl WHERE jl."employeeId" = e."id" AND jl."accountId" = ${advances}), 0)::text AS advances,
             COALESCE((SELECT SUM(v."amount") FROM "payment_vouchers" v WHERE v."employeeId" = e."id" AND v."kind" = 'SALARY' AND v."status" = 'ACTIVE'
               ${f.from ? sql`AND v."date" >= ${dt(f.from)}` : empty} ${f.to ? sql`AND v."date" <= ${dt(f.to)}` : empty}), 0)::text AS paid
      FROM "employees" e
      WHERE ${andAll(conds)}
      ORDER BY e."isTeacher" DESC, e."fullName"`
    const out: Row[] = rows.map((r) => ({
      _employeeId: n(r.id),
      number: String(r.employeeNumber),
      name: String(r.fullName),
      job: (r.jobTitle as string) ?? '—',
      department: (r.department as string) ?? '—',
      kind: r.isTeacher ? 'معلم' : 'إداري',
      phone: (r.phone as string) ?? '',
      hireDate: d(r.hireDate as Date | null),
      status: EMPLOYEE_STATUS[String(r.status)]?.label ?? String(r.status),
      ...(salaries
        ? { salaryType: SALARY_TYPE[String(r.salaryType)] ?? String(r.salaryType), salary: m(r.salary), due: m(r.due), advances: m(r.advances), paid: m(r.paid) }
        : {}),
    }))
    const columns: ReportColumn[] = [
      { key: 'number', header: 'الرقم', width: 10 },
      { key: 'name', header: 'الاسم', width: 26, href: employeeHref },
      { key: 'job', header: 'الوظيفة', width: 18 },
      { key: 'department', header: 'القسم', width: 16 },
      { key: 'kind', header: 'النوع', width: 8 },
      { key: 'phone', header: 'الهاتف', width: 14 },
      { key: 'hireDate', header: 'التعيين', type: 'date' },
      { key: 'status', header: 'الحالة', width: 12 },
    ]
    if (salaries) {
      columns.push(
        { key: 'salaryType', header: 'نوع الراتب', width: 10 },
        { key: 'salary', header: 'الراتب', type: 'money' },
        { key: 'due', header: 'مستحق غير مصروف', type: 'money' },
        { key: 'advances', header: 'سلف عليه', type: 'money' },
        { key: 'paid', header: 'المصروف في الفترة', type: 'money' },
      )
    }
    const totals = salaries ? totalsOf(out, ['salary', 'due', 'advances', 'paid'], { key: 'name', text: `الإجمالي (${out.length} موظف)` }) : { name: `العدد: ${out.length}` }
    return {
      columns,
      rows: out,
      totals,
      summary: [
        { label: 'عدد الموظفين', value: out.length, type: 'number' },
        { label: 'المعلمون', value: out.filter((r) => r.kind === 'معلم').length, type: 'number' },
        ...(salaries
          ? [
              { label: 'مجموع الرواتب الأساسية', value: totals.salary as string, type: 'money' as const },
              { label: 'المصروف في الفترة', value: totals.paid as string, type: 'money' as const },
            ]
          : []),
      ],
    }
  },
}

// ---------------------------------------------------------------------
// 16. الموردون
// ---------------------------------------------------------------------

export const suppliersReport: ReportDef = {
  id: 'suppliers',
  title: 'تقرير الموردين',
  description: 'لكل مورد: الرصيد في بداية الفترة، الفواتير والدفعات خلالها، والرصيد المستحق في نهايتها.',
  group: 'staff',
  permissions: ['suppliers.view'],
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'supplier' },
    { key: 'kind', label: 'عرض', options: [{ value: 'balance', label: 'عليهم مستحقات' }, { value: 'active', label: 'لهم حركة في الفترة' }] },
    { key: 'amount', label: 'الرصيد' },
    { key: 'q' },
  ],
  async run(f) {
    const ap = await accountIdByKey(db, 'AP_SUPPLIERS')
    const conds: Prisma.Sql[] = [...searchLike(sql`s."searchText"`, f.q)]
    if (f.supplierId) conds.push(sql`s."id" = ${f.supplierId}`)
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT s."id", s."name", s."category", s."phone",
        COALESCE(SUM(jl."credit" - jl."debit") FILTER (WHERE ${f.from ? sql`jl."date" < ${dt(f.from)}` : sql`FALSE`}), 0)::text AS opening,
        COALESCE(SUM(jl."credit") FILTER (WHERE ${andAll(dateRange(sql`jl."date"`, f.from, f.to))}), 0)::text AS bills,
        COALESCE(SUM(jl."debit") FILTER (WHERE ${andAll(dateRange(sql`jl."date"`, f.from, f.to))}), 0)::text AS payments,
        COALESCE(SUM(jl."credit" - jl."debit") FILTER (WHERE ${f.to ? sql`jl."date" <= ${dt(f.to)}` : sql`TRUE`}), 0)::text AS closing
      FROM "suppliers" s
      LEFT JOIN "journal_lines" jl ON jl."supplierId" = s."id" AND jl."accountId" = ${ap}
      WHERE ${andAll(conds)}
      GROUP BY s."id"
      ORDER BY s."name"`
    let out: Row[] = rows.map((r) => ({
      _supplierId: n(r.id),
      name: String(r.name),
      category: (r.category as string) ?? '—',
      phone: (r.phone as string) ?? '',
      opening: m(r.opening),
      bills: m(r.bills),
      payments: m(r.payments),
      closing: m(r.closing),
    }))
    if (f.kind === 'balance') out = out.filter((r) => D(String(r.closing)).greaterThan(0))
    if (f.kind === 'active') out = out.filter((r) => !D(String(r.bills)).isZero() || !D(String(r.payments)).isZero())
    if (f.min) out = out.filter((r) => D(String(r.closing)).greaterThanOrEqualTo(D(f.min!)))
    if (f.max) out = out.filter((r) => D(String(r.closing)).lessThanOrEqualTo(D(f.max!)))
    const totals = totalsOf(out, ['opening', 'bills', 'payments', 'closing'], { key: 'name', text: `الإجمالي (${out.length} مورد)` })
    return {
      columns: [
        { key: 'name', header: 'المورد', width: 26, href: (r) => `/suppliers/${r._supplierId}` },
        { key: 'category', header: 'التصنيف', width: 16 },
        { key: 'phone', header: 'الهاتف', width: 14 },
        { key: 'opening', header: 'رصيد أول الفترة', type: 'money' },
        { key: 'bills', header: 'الفواتير', type: 'money' },
        { key: 'payments', header: 'الدفعات', type: 'money' },
        { key: 'closing', header: 'الرصيد المستحق', type: 'money' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'فواتير الفترة', value: totals.bills, type: 'money' },
        { label: 'دفعات الفترة', value: totals.payments, type: 'money' },
        { label: 'المستحق للموردين', value: sum(out.map((r) => (D(String(r.closing)).greaterThan(0) ? String(r.closing) : '0'))).toString(), type: 'money' },
      ],
      note: 'الفواتير والدفعات تشمل قيود الإلغاء في تاريخها؛ الرصيد هو المستحق فعليًا بعد الإلغاءات.',
    }
  },
}
