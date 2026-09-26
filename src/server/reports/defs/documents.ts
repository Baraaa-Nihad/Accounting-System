import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '../../db'
import { D, sum } from '@/lib/money'
import { DOC_STATUS, PAYMENT_METHOD, RECEIPT_KIND, VOUCHER_KIND } from '@/lib/labels'
import { amountRange, andAll, d, dateRange, m, n, sql } from '../sql'
import type { Breakdown, ReportDef, Row } from '../types'

/** التقريران 9 و 10: سندات القبض وسندات الصرف. */

const statusFilter = { key: 'status' as const, options: [{ value: 'ACTIVE', label: 'فعالة' }, { value: 'CANCELLED', label: 'ملغاة' }], allLabel: 'الكل' }

function byLabel(rows: { label: string; amount: string }[]): Breakdown['rows'] {
  const map = new Map<string, { count: number; amount: ReturnType<typeof D> }>()
  for (const r of rows) {
    const g = map.get(r.label) ?? { count: 0, amount: D(0) }
    g.count++
    g.amount = g.amount.plus(D(r.amount))
    map.set(r.label, g)
  }
  return [...map.entries()].sort((a, b) => b[1].amount.comparedTo(a[1].amount)).map(([label, g]) => ({ label, count: g.count, amount: g.amount.toString() }))
}

const breakdownColumns = [
  { key: 'label', header: 'البند', width: 26 },
  { key: 'count', header: 'العدد', type: 'number' as const },
  { key: 'amount', header: 'المبلغ', type: 'money' as const },
]

export const receiptsReport: ReportDef = {
  id: 'receipts',
  title: 'تقرير سندات القبض',
  description: 'كل سندات القبض بأنواعها (طلاب، عائلات، إيرادات أخرى، رأس مال) مع حالتها.',
  group: 'documents',
  permissions: ['receipts.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'month' },
    { key: 'kind', label: 'نوع السند', options: Object.entries(RECEIPT_KIND).map(([value, label]) => ({ value, label })) },
    { key: 'student' },
    { key: 'method' },
    { key: 'account' },
    { key: 'user' },
    { key: 'amount' },
    statusFilter,
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [...dateRange(sql`r."date"`, f.from, f.to), ...amountRange(sql`r."amount"`, f.min, f.max)]
    if (f.kind) conds.push(sql`r."kind"::text = ${f.kind}`)
    if (f.status) conds.push(sql`r."status"::text = ${f.status}`)
    if (f.method) conds.push(sql`r."paymentMethod"::text = ${f.method}`)
    if (f.userId) conds.push(sql`r."createdById" = ${f.userId}`)
    if (f.accountId) conds.push(sql`r."cashAccountId" = ${f.accountId}`)
    if (f.studentId) conds.push(sql`EXISTS (SELECT 1 FROM "payment_allocations" pa WHERE pa."receiptId" = r."id" AND pa."studentId" = ${f.studentId})`)
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT r."id", r."number", r."date", r."kind"::text AS kind, r."payerName", r."amount"::text AS amount, r."paymentMethod"::text AS method,
             r."status"::text AS status, r."cancelReason", s."id" AS "studentId", s."fullName" AS "studentName", gu."name" AS "guardianName",
             ca."name" AS "accountName", u."fullName" AS "userName", a."name" AS "revenueName", p."name" AS "partnerName"
      FROM "receipts" r
      LEFT JOIN "students" s ON s."id" = r."studentId"
      LEFT JOIN "guardians" gu ON gu."id" = r."guardianId"
      LEFT JOIN "cash_accounts" ca ON ca."id" = r."cashAccountId"
      LEFT JOIN "users" u ON u."id" = r."createdById"
      LEFT JOIN "accounts" a ON a."id" = r."revenueAccountId"
      LEFT JOIN "partners" p ON p."id" = r."partnerId"
      WHERE ${andAll(conds)}
      ORDER BY r."date" DESC, r."id" DESC`
    const out: Row[] = rows.map((r) => ({
      _receiptId: n(r.id),
      _studentId: r.studentId ? n(r.studentId) : null,
      date: d(r.date as Date),
      number: String(r.number),
      kind: RECEIPT_KIND[String(r.kind)] ?? String(r.kind),
      payer: String(r.payerName),
      about: r.studentName
        ? String(r.studentName)
        : r.guardianName
          ? `عائلة ${r.guardianName}`
          : ((r.revenueName as string) ?? (r.partnerName ? `الشريك ${r.partnerName}` : '—')),
      method: PAYMENT_METHOD[String(r.method)] ?? String(r.method),
      account: (r.accountName as string) ?? '—',
      amount: m(r.amount),
      user: (r.userName as string) ?? '—',
      status: `${DOC_STATUS[String(r.status)]?.label ?? r.status}${r.cancelReason ? ` — ${r.cancelReason}` : ''}`,
    }))
    const active = out.filter((_, i) => rows[i].status === 'ACTIVE')
    const total = sum(active.map((r) => String(r.amount)))
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'number', header: 'رقم السند', width: 18, href: (r) => `/receipts/${r._receiptId}` },
        { key: 'kind', header: 'النوع', width: 14 },
        { key: 'payer', header: 'الدافع', width: 22 },
        { key: 'about', header: 'عن', width: 24, href: (r) => (r._studentId ? `/students/${r._studentId}` : null) },
        { key: 'method', header: 'الطريقة', width: 12 },
        { key: 'account', header: 'الحساب', width: 16 },
        { key: 'amount', header: 'المبلغ', type: 'money' },
        { key: 'user', header: 'المستخدم', width: 14 },
        { key: 'status', header: 'الحالة', width: 16 },
      ],
      rows: out,
      totals: { payer: `إجمالي السندات الفعالة (${active.length})`, amount: total.toString() },
      summary: [
        { label: 'إجمالي المقبوض (الفعال)', value: total.toString(), type: 'money' },
        { label: 'عدد السندات الفعالة', value: active.length, type: 'number' },
        { label: 'السندات الملغاة', value: out.length - active.length, type: 'number' },
      ],
      breakdowns: [{ title: 'حسب نوع السند', columns: breakdownColumns, rows: byLabel(active.map((r) => ({ label: String(r.kind), amount: String(r.amount) }))) }],
    }
  },
}

export const vouchersReport: ReportDef = {
  id: 'vouchers',
  title: 'تقرير سندات الصرف',
  description: 'كل سندات الصرف: المصروفات، الموردون، المقاولون، الرواتب، السلف، المرتجعات، ومسحوبات الشركاء.',
  group: 'documents',
  permissions: ['vouchers.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'month' },
    { key: 'kind', label: 'نوع الصرف', options: Object.entries(VOUCHER_KIND).map(([value, label]) => ({ value, label })) },
    { key: 'method' },
    { key: 'account' },
    { key: 'user' },
    { key: 'amount' },
    statusFilter,
    { key: 'q' },
  ],
  async run(f) {
    const conds: Prisma.Sql[] = [...dateRange(sql`v."date"`, f.from, f.to), ...amountRange(sql`v."amount"`, f.min, f.max)]
    if (f.kind) conds.push(sql`v."kind"::text = ${f.kind}`)
    if (f.status) conds.push(sql`v."status"::text = ${f.status}`)
    if (f.method) conds.push(sql`v."paymentMethod"::text = ${f.method}`)
    if (f.userId) conds.push(sql`v."createdById" = ${f.userId}`)
    if (f.accountId) conds.push(sql`v."cashAccountId" = ${f.accountId}`)
    if (f.q) conds.push(sql`(v."payeeName" ILIKE ${`%${f.q}%`} OR v."description" ILIKE ${`%${f.q}%`} OR v."number" ILIKE ${`%${f.q}%`})`)
    const rows = await db.$queryRaw<Record<string, unknown>[]>`
      SELECT v."id", v."number", v."date", v."kind"::text AS kind, v."payeeName", v."amount"::text AS amount, v."paymentMethod"::text AS method,
             v."status"::text AS status, v."cancelReason", v."description", a."name" AS "categoryName", ca."name" AS "accountName", u."fullName" AS "userName"
      FROM "payment_vouchers" v
      LEFT JOIN "accounts" a ON a."id" = v."expenseAccountId"
      LEFT JOIN "cash_accounts" ca ON ca."id" = v."cashAccountId"
      LEFT JOIN "users" u ON u."id" = v."createdById"
      WHERE ${andAll(conds)}
      ORDER BY v."date" DESC, v."id" DESC`
    const out: Row[] = rows.map((r) => ({
      _voucherId: n(r.id),
      date: d(r.date as Date),
      number: String(r.number),
      kind: VOUCHER_KIND[String(r.kind)] ?? String(r.kind),
      category: (r.categoryName as string) ?? '—',
      payee: String(r.payeeName),
      description: (r.description as string) ?? '',
      method: PAYMENT_METHOD[String(r.method)] ?? String(r.method),
      account: (r.accountName as string) ?? '—',
      amount: m(r.amount),
      user: (r.userName as string) ?? '—',
      status: `${DOC_STATUS[String(r.status)]?.label ?? r.status}${r.cancelReason ? ` — ${r.cancelReason}` : ''}`,
    }))
    const active = out.filter((_, i) => rows[i].status === 'ACTIVE')
    const total = sum(active.map((r) => String(r.amount)))
    return {
      columns: [
        { key: 'date', header: 'التاريخ', type: 'date' },
        { key: 'number', header: 'رقم السند', width: 18, href: (r) => `/vouchers/${r._voucherId}` },
        { key: 'kind', header: 'النوع', width: 14 },
        { key: 'category', header: 'التصنيف', width: 16 },
        { key: 'payee', header: 'المستفيد', width: 22 },
        { key: 'description', header: 'البيان', width: 28 },
        { key: 'method', header: 'الطريقة', width: 12 },
        { key: 'account', header: 'من', width: 16 },
        { key: 'amount', header: 'المبلغ', type: 'money' },
        { key: 'user', header: 'المستخدم', width: 14 },
        { key: 'status', header: 'الحالة', width: 16 },
      ],
      rows: out,
      totals: { payee: `إجمالي السندات الفعالة (${active.length})`, amount: total.toString() },
      summary: [
        { label: 'إجمالي المصروف (الفعال)', value: total.toString(), type: 'money' },
        { label: 'عدد السندات الفعالة', value: active.length, type: 'number' },
        { label: 'السندات الملغاة', value: out.length - active.length, type: 'number' },
      ],
      breakdowns: [{ title: 'حسب نوع الصرف', columns: breakdownColumns, rows: byLabel(active.map((r) => ({ label: String(r.kind), amount: String(r.amount) }))) }],
    }
  },
}

