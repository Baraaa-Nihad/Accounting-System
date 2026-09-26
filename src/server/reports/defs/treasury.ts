import 'server-only'
import { db } from '../../db'
import { cashAccountsSummary } from '../../services/treasury'
import { statement, sourceHref } from '../../ledger/statements'
import { D, sum } from '@/lib/money'
import { m } from '../sql'
import type { ReportDef, ReportFilters, ReportResult, Row } from '../types'

/** التقريران 17 و 18: حركة الصناديق والبنوك. */

async function cashReport(type: 'CASHBOX' | 'BANK', f: ReportFilters): Promise<ReportResult> {
  const label = type === 'CASHBOX' ? 'الصندوق' : 'الحساب البنكي'
  const account = f.accountId ? await db.cashAccount.findFirst({ where: { id: f.accountId, type } }) : null

  if (!account) {
    // كل الحسابات: ملخص لكل حساب
    const list = (await cashAccountsSummary(db, f.from || f.to ? { from: f.from ?? undefined, to: f.to ?? undefined } : undefined)).filter((a) => a.type === type)
    const out: Row[] = list.map((a) => ({
      _accountId: a.id,
      name: a.name,
      details: [a.bankName, a.accountNumber].filter(Boolean).join(' — '),
      opening: m(a.opening),
      receipts: m(a.receipts),
      payments: m(a.payments),
      transfersIn: m(a.transfersIn),
      transfersOut: m(a.transfersOut),
      closing: m(a.balance),
    }))
    const keys = ['opening', 'receipts', 'payments', 'transfersIn', 'transfersOut', 'closing']
    const totals: Row = { name: 'الإجمالي' }
    for (const k of keys) totals[k] = sum(out.map((r) => String(r[k]))).toString()
    return {
      columns: [
        { key: 'name', header: label, width: 24, href: (r) => `/treasury/${r._accountId}` },
        ...(type === 'BANK' ? [{ key: 'details', header: 'البنك / الحساب', width: 24 }] : []),
        { key: 'opening', header: f.from ? 'رصيد أول الفترة' : 'الافتتاحي', type: 'money' },
        { key: 'receipts', header: 'المقبوضات', type: 'money' },
        { key: 'payments', header: 'المدفوعات', type: 'money' },
        { key: 'transfersIn', header: 'تحويلات واردة', type: 'money' },
        { key: 'transfersOut', header: 'تحويلات صادرة', type: 'money' },
        { key: 'closing', header: f.to ? 'رصيد آخر الفترة' : 'الرصيد الحالي', type: 'money' },
      ],
      rows: out,
      totals,
      summary: [
        { label: 'المقبوضات', value: totals.receipts, type: 'money' },
        { label: 'المدفوعات', value: totals.payments, type: 'money' },
        { label: 'الرصيد', value: totals.closing, type: 'money' },
      ],
      note: `اختر ${label} من الفلتر لعرض كشف حركته التفصيلي مع الرصيد التراكمي.`,
    }
  }

  const st = await statement(db, { accountIds: [account.glAccountId], from: f.from, to: f.to }, 1)
  let rows = st.rows
  if (f.kind === 'in') rows = rows.filter((r) => D(r.debit).greaterThan(0))
  if (f.kind === 'out') rows = rows.filter((r) => D(r.credit).greaterThan(0))
  if (f.min) rows = rows.filter((r) => D(r.debit).plus(D(r.credit)).greaterThanOrEqualTo(D(f.min!)))
  if (f.max) rows = rows.filter((r) => D(r.debit).plus(D(r.credit)).lessThanOrEqualTo(D(f.max!)))
  const filtered = rows.length !== st.rows.length
  const out: Row[] = [
    ...(f.from && !filtered ? [{ date: f.from, description: 'رصيد أول الفترة', ref: '', in: null, out: null, balance: st.opening }] : []),
    ...rows.map((r) => ({
      _href: sourceHref(r.sourceType, r.sourceId),
      date: r.date,
      description: `${r.description}${r.reversed ? ' (أُلغي)' : r.isReversal ? ' (قيد إلغاء)' : ''}`,
      ref: r.entryNumber,
      in: m(r.debit),
      out: m(r.credit),
      balance: filtered ? null : m(r.balance),
    })),
  ]
  const tin = sum(rows.map((r) => r.debit))
  const tout = sum(rows.map((r) => r.credit))
  return {
    columns: [
      { key: 'date', header: 'التاريخ', type: 'date' },
      { key: 'description', header: 'البيان', width: 56 },
      { key: 'ref', header: 'المرجع', width: 16, href: (r) => (r._href as string) ?? null },
      { key: 'in', header: 'وارد', type: 'money' },
      { key: 'out', header: 'صادر', type: 'money' },
      { key: 'balance', header: 'الرصيد', type: 'money' },
    ],
    rows: out,
    totals: { description: 'الإجمالي', in: tin.toString(), out: tout.toString(), balance: filtered ? null : st.closing },
    summary: [
      { label: 'رصيد أول الفترة', value: st.opening, type: 'money' },
      { label: 'الوارد', value: tin.toString(), type: 'money' },
      { label: 'الصادر', value: tout.toString(), type: 'money' },
      { label: 'رصيد آخر الفترة', value: st.closing, type: 'money' },
    ],
    note: filtered ? 'الرصيد التراكمي مخفي لأن الفلتر يعرض جزءًا من الحركات.' : undefined,
  }
}

const cashFilters = (type: 'CASHBOX' | 'BANK'): ReportDef['filters'] => [
  { key: 'account', accountType: type, label: type === 'CASHBOX' ? 'الصندوق' : 'الحساب البنكي' },
  { key: 'period', defaultPeriod: 'month' },
  { key: 'kind', label: 'الحركة', options: [{ value: 'in', label: 'الوارد فقط' }, { value: 'out', label: 'الصادر فقط' }] },
  { key: 'amount' },
]

export const cashboxReport: ReportDef = {
  id: 'cashbox',
  title: 'تقرير الصندوق',
  description: 'حركة الصناديق النقدية: الرصيد الافتتاحي، المقبوضات، المدفوعات، التحويلات، والرصيد — أو كشف حركة صندوق محدد.',
  group: 'treasury',
  permissions: ['treasury.view'],
  filters: cashFilters('CASHBOX'),
  run: (f) => cashReport('CASHBOX', f),
}

export const bankReport: ReportDef = {
  id: 'bank',
  title: 'تقرير البنك',
  description: 'حركة الحسابات البنكية: الإيداعات والسحوبات والتحويلات والرصيد — أو كشف حركة حساب محدد.',
  group: 'treasury',
  permissions: ['treasury.view'],
  filters: cashFilters('BANK'),
  run: (f) => cashReport('BANK', f),
}
