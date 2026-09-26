import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '../../db'
import { accountByKey } from '../../ledger/accounts'
import { sourceHref } from '../../ledger/statements'
import { D, sum } from '@/lib/money'
import { ARABIC_MONTHS } from '@/lib/dates'
import { andAll, d, dateRange, dt, empty, m, n, pct, sql } from '../sql'
import type { ReportDef, ReportFilters, ReportResult, Row } from '../types'

/** التقارير 11، 12، 19: الإيرادات، المصروفات، الأرباح والخسائر (من الأستاذ العام — أساس الاستحقاق). */

/** قيود إقفال السنة لا تدخل في قائمة الدخل. */
const NOT_CLOSING = sql`je."sourceType" <> 'YEAR_CLOSE'`

async function categoryReport(type: 'EXPENSE' | 'REVENUE', f: ReportFilters): Promise<ReportResult> {
  const sign = type === 'EXPENSE' ? sql`jl."debit" - jl."credit"` : sql`jl."credit" - jl."debit"`
  const lineConds: Prisma.Sql[] = [sql`a."type"::text = ${type}`, NOT_CLOSING, ...dateRange(sql`jl."date"`, f.from, f.to)]
  if (f.categoryId) lineConds.push(sql`a."id" = ${f.categoryId}`)

  if (f.kind === 'details') {
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT jl."id", jl."date", a."name" AS category, COALESCE(jl."description", je."description") AS description, je."number",
             je."sourceType", je."sourceId", (${sign})::text AS amount, u."fullName" AS "userName"
      FROM "journal_lines" jl
      JOIN "journal_entries" je ON je."id" = jl."entryId"
      JOIN "accounts" a ON a."id" = jl."accountId"
      LEFT JOIN "users" u ON u."id" = je."createdById"
      WHERE ${andAll(lineConds)}
      ORDER BY jl."date" DESC, jl."id" DESC
      LIMIT 20000`
    const out: Row[] = rows.map((r) => ({
      _href: sourceHref(String(r.sourceType), r.sourceId === null ? null : n(r.sourceId)),
      date: d(r.date as Date),
      category: String(r.category),
      description: String(r.description ?? ''),
      ref: String(r.number),
      amount: m(r.amount),
      user: (r.userName as string) ?? '—',
    }))
    const total = sum(out.map((r) => String(r.amount)))
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'category', header: 'التصنيف', width: 20 },
        { key: 'description', header: 'البيان', width: 50 },
        { key: 'ref', header: 'القيد', width: 16, href: (r) => (r._href as string) ?? null },
        { key: 'amount', header: 'المبلغ', type: 'money' },
        { key: 'user', header: 'المستخدم', width: 14 },
      ],
      rows: out,
      totals: { description: `الإجمالي (${out.length} حركة)`, amount: total.toString() },
      summary: [
        { label: type === 'EXPENSE' ? 'إجمالي المصروفات' : 'إجمالي الإيرادات', value: total.toString(), type: 'money' },
        { label: 'عدد الحركات', value: out.length, type: 'number' },
      ],
    }
  }

  const [rows, months] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT a."id", a."code", a."name", a."systemKey", p."name" AS "parentName",
             COALESCE(SUM(${sign}) FILTER (WHERE jl."id" IS NOT NULL), 0)::text AS total, COUNT(jl."id") AS cnt
      FROM "accounts" a
      LEFT JOIN "accounts" p ON p."id" = a."parentId"
      LEFT JOIN "journal_lines" jl ON jl."accountId" = a."id" ${f.from ? sql`AND jl."date" >= ${dt(f.from)}` : empty} ${f.to ? sql`AND jl."date" <= ${dt(f.to)}` : empty}
        AND jl."entryId" NOT IN (SELECT "id" FROM "journal_entries" WHERE "sourceType" = 'YEAR_CLOSE')
      WHERE a."type"::text = ${type} AND a."isGroup" = false ${f.categoryId ? sql`AND a."id" = ${f.categoryId}` : empty}
      GROUP BY a."id", p."name"
      HAVING COUNT(jl."id") > 0 OR a."isActive" = true
      ORDER BY a."code"`,
    db.$queryRaw<{ month: Date; total: string }[]>`
      SELECT date_trunc('month', jl."date")::date AS month, COALESCE(SUM(${sign}), 0)::text AS total
      FROM "journal_lines" jl JOIN "journal_entries" je ON je."id" = jl."entryId" JOIN "accounts" a ON a."id" = jl."accountId"
      WHERE ${andAll(lineConds)}
      GROUP BY 1 ORDER BY 1`,
  ])
  const total = sum(rows.map((r) => String(r.total)))
  const out: Row[] = rows
    .filter((r) => !D(String(r.total)).isZero() || n(r.cnt) > 0)
    .map((r) => ({
      _categoryId: n(r.id),
      code: String(r.code),
      name: String(r.name),
      group: (r.parentName as string) ?? '',
      count: n(r.cnt),
      amount: m(r.total),
      share: pct(r.total, total.toString()),
    }))
    .sort((a, b) => D(String(b.amount)).comparedTo(D(String(a.amount))))
  const path = type === 'EXPENSE' ? '/expenses' : '/revenues'
  return {
    columns: [
      { key: 'code', header: 'الرمز', width: 10 },
      { key: 'name', header: 'التصنيف', width: 26, href: (r) => `${path}?category=${r._categoryId}` },
      { key: 'group', header: 'المجموعة', width: 22 },
      { key: 'count', header: 'عدد الحركات', type: 'number' },
      { key: 'amount', header: 'المبلغ', type: 'money' },
      { key: 'share', header: 'النسبة %', type: 'percent' },
    ],
    rows: out,
    totals: { name: 'الإجمالي', amount: total.toString(), share: out.length ? 100 : null },
    summary: [
      { label: type === 'EXPENSE' ? 'إجمالي المصروفات' : 'صافي الإيرادات', value: total.toString(), type: 'money' },
      { label: 'عدد التصنيفات', value: out.length, type: 'number' },
    ],
    breakdowns: [
      {
        title: 'حسب الشهر',
        columns: [
          { key: 'month', header: 'الشهر', width: 18 },
          { key: 'amount', header: 'المبلغ', type: 'money' },
        ],
        rows: months.map((r) => {
          const key = d(r.month)!
          return { month: `${ARABIC_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, amount: m(r.total) }
        }),
      },
    ],
  }
}

const modeFilter = {
  key: 'kind' as const,
  label: 'العرض',
  options: [
    { value: 'summary', label: 'حسب التصنيف' },
    { value: 'details', label: 'الحركات التفصيلية' },
  ],
  defaultValue: 'summary',
}

export const revenuesReport: ReportDef = {
  id: 'revenues',
  title: 'تقرير الإيرادات',
  description: 'الإيرادات حسب التصنيف (الرسوم الدراسية حسب نوع الذمة، الإيرادات الأخرى) مع الخصومات، ثم حسب الشهر.',
  group: 'pnl',
  permissions: ['revenues.view'],
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'year' },
    modeFilter,
    {
      key: 'category',
      label: 'التصنيف',
      loadOptions: async () => (await db.account.findMany({ where: { type: 'REVENUE', isGroup: false }, orderBy: { code: 'asc' } })).map((a) => ({ value: String(a.id), label: a.name })),
    },
  ],
  run: (f) => categoryReport('REVENUE', f),
}

export const expensesReport: ReportDef = {
  id: 'expenses',
  title: 'تقرير المصروفات',
  description: 'المصروفات حسب التصنيف (تشمل الرواتب والفواتير وأعمال المقاولين وسندات الصرف)، ثم حسب الشهر.',
  group: 'pnl',
  permissions: ['expenses.view'],
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'year' },
    modeFilter,
    {
      key: 'category',
      label: 'التصنيف',
      loadOptions: async () => (await db.account.findMany({ where: { type: 'EXPENSE', isGroup: false }, orderBy: { code: 'asc' } })).map((a) => ({ value: String(a.id), label: a.name })),
    },
  ],
  run: (f) => categoryReport('EXPENSE', f),
}

// ---------------------------------------------------------------------
// 19. الأرباح والخسائر
// ---------------------------------------------------------------------

export const profitLoss: ReportDef = {
  id: 'profit-loss',
  title: 'تقرير الأرباح والخسائر',
  description: 'قائمة الدخل للفترة: الإيرادات − الخصومات − المصروفات = صافي الربح، مع الملخص النقدي وحصص الشركاء.',
  group: 'financial',
  permissions: ['reports.financial'],
  filters: [{ key: 'period', defaultPeriod: 'year' }, { key: 'year' }],
  async run(f) {
    const range = dateRange(sql`jl."date"`, f.from, f.to)
    const rows = await db.$queryRaw<{ id: number; code: string; name: string; type: string; systemKey: string | null; parentId: number | null; total: string }[]>`
      SELECT a."id", a."code", a."name", a."type"::text AS type, a."systemKey", a."parentId",
             COALESCE(SUM(CASE WHEN a."type" = 'REVENUE' THEN jl."credit" - jl."debit" ELSE jl."debit" - jl."credit" END), 0)::text AS total
      FROM "journal_lines" jl
      JOIN "journal_entries" je ON je."id" = jl."entryId"
      JOIN "accounts" a ON a."id" = jl."accountId"
      WHERE a."type" IN ('REVENUE', 'EXPENSE') AND ${NOT_CLOSING} ${range.length ? sql`AND ${andAll(range)}` : empty}
      GROUP BY a."id"
      ORDER BY a."code"`
    const studentGroup = await accountByKey(db, 'STUDENT_REVENUE_GROUP')
    const nonZero = rows.filter((r) => !D(r.total).isZero())
    const students = nonZero.filter((r) => r.type === 'REVENUE' && r.code.startsWith(studentGroup.code) && r.systemKey !== 'DISCOUNTS_ALLOWED')
    const discounts = nonZero.filter((r) => r.systemKey === 'DISCOUNTS_ALLOWED')
    const others = nonZero.filter((r) => r.type === 'REVENUE' && !students.includes(r) && !discounts.includes(r))
    const expenses = nonZero.filter((r) => r.type === 'EXPENSE')
    const tStudents = sum(students.map((r) => r.total))
    const tDiscounts = sum(discounts.map((r) => r.total)).negated()
    const tOthers = sum(others.map((r) => r.total))
    const netRevenue = tStudents.minus(tDiscounts).plus(tOthers)
    const tExpenses = sum(expenses.map((r) => r.total))
    const profit = netRevenue.minus(tExpenses)

    const out: Row[] = []
    const section = (label: string) => out.push({ _style: 'section', item: label, amount: null })
    const item = (label: string, amount: ReturnType<typeof D> | string, code?: string) => out.push({ _style: 'item', code: code ?? '', item: label, amount: D(amount).toString() })
    const subtotal = (label: string, amount: ReturnType<typeof D>) => out.push({ _style: 'subtotal', item: label, amount: amount.toString() })
    section('الإيرادات')
    for (const r of students) item(r.name, r.total, r.code)
    subtotal('إجمالي إيرادات الرسوم الدراسية', tStudents)
    for (const r of discounts) item(r.name, r.total, r.code)
    for (const r of others) item(r.name, r.total, r.code)
    if (others.length) subtotal('إجمالي الإيرادات الأخرى', tOthers)
    subtotal('صافي الإيرادات', netRevenue)
    section('المصروفات')
    for (const r of expenses) item(r.name, r.total, r.code)
    subtotal('إجمالي المصروفات', tExpenses)
    out.push({ _style: 'total', item: profit.isNegative() ? 'صافي الخسارة' : 'صافي الربح', amount: profit.toString() })

    // الملخص النقدي (المقبوض والمصروف فعليًا)
    const [cashIn, cashOut, partners] = await Promise.all([
      db.$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM("amount"), 0)::text AS total FROM "receipts" WHERE "status" = 'ACTIVE' AND "kind" IN ('STUDENT', 'FAMILY', 'OTHER_REVENUE') ${f.from ? sql`AND "date" >= ${dt(f.from)}` : empty} ${f.to ? sql`AND "date" <= ${dt(f.to)}` : empty}`,
      db.$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM("amount"), 0)::text AS total FROM "payment_vouchers" WHERE "status" = 'ACTIVE' AND "kind" NOT IN ('PARTNER_WITHDRAWAL', 'ADVANCE') ${f.from ? sql`AND "date" >= ${dt(f.from)}` : empty} ${f.to ? sql`AND "date" <= ${dt(f.to)}` : empty}`,
      db.partner.findMany({ where: { isActive: true, ownershipPercent: { gt: 0 } }, orderBy: { name: 'asc' } }),
    ])
    const inflow = D(cashIn[0].total)
    const outflow = D(cashOut[0].total)
    return {
      columns: [
        { key: 'code', header: 'الرمز', width: 10 },
        { key: 'item', header: 'البند', width: 44 },
        { key: 'amount', header: 'المبلغ', type: 'money' },
      ],
      rows: out,
      summary: [
        { label: 'صافي الإيرادات', value: netRevenue.toString(), type: 'money' },
        { label: 'المصروفات', value: tExpenses.toString(), type: 'money' },
        { label: profit.isNegative() ? 'صافي الخسارة' : 'صافي الربح', value: profit.toString(), type: 'money' },
        { label: 'هامش الربح', value: pct(profit.toString(), netRevenue.toString()), type: 'percent' },
      ],
      breakdowns: [
        {
          title: 'الملخص النقدي (المقبوض والمصروف فعليًا)',
          columns: [
            { key: 'label', header: 'البند', width: 34 },
            { key: 'amount', header: 'المبلغ', type: 'money' },
          ],
          rows: [
            { label: 'المقبوض من الطلاب والإيرادات الأخرى', amount: inflow.toString() },
            { label: 'المصروف (دون السلف ومسحوبات الشركاء)', amount: outflow.toString() },
            { label: 'صافي الحركة النقدية', amount: inflow.minus(outflow).toString() },
          ],
        },
        ...(partners.length
          ? [
              {
                title: 'حصص الشركاء من صافي الربح',
                columns: [
                  { key: 'label', header: 'الشريك', width: 26 },
                  { key: 'percent', header: 'نسبة الملكية %', type: 'percent' as const },
                  { key: 'amount', header: 'الحصة', type: 'money' as const },
                ],
                rows: partners.map((p) => ({
                  label: p.name,
                  percent: D(p.ownershipPercent).toNumber(),
                  amount: profit.times(D(p.ownershipPercent)).dividedBy(100).toDecimalPlaces(2).toString(),
                })),
              },
            ]
          : []),
      ],
      note: 'على أساس الاستحقاق: الإيراد عند إصدار الذمة، والمصروف عند الفاتورة أو الاتفاق أو اعتماد الرواتب.',
    }
  },
}
