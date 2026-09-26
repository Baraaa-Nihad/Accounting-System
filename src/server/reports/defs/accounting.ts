import 'server-only'
import { db } from '../../db'
import { balanceSheet, trialBalance, type SectionRow } from '../../services/financial-statements'
import { ACCOUNT_TYPE } from '@/lib/labels'
import type { ReportDef, Row } from '../types'

/** القوائم المحاسبية الرسمية من الأستاذ العام: ميزان المراجعة والميزانية العمومية. */

const ledgerHref = (row: Row) => (row.accountId ? `/accounting/ledger?account=${row.accountId}` : null)
const indent = (depth: number) => ' '.repeat(depth * 4)

export const trialBalanceReport: ReportDef = {
  id: 'trial-balance',
  title: 'ميزان المراجعة',
  description: 'أرصدة كل الحسابات: الافتتاحي وحركة الفترة والختامي (مدين/دائن)، مع التحقق من التوازن.',
  group: 'accounting',
  permissions: ['accounting.view'],
  landscape: true,
  filters: [
    { key: 'period', defaultPeriod: 'year' },
    { key: 'year' },
    { key: 'status', label: 'قيود الإقفال', allLabel: 'تشمل قيود الإقفال', options: [{ value: 'exclude', label: 'قبل قيود الإقفال' }] },
    { key: 'kind', label: 'الحسابات', allLabel: 'ذات الحركة فقط', options: [{ value: 'all', label: 'كل الحسابات' }] },
  ],
  async run(f, env) {
    const to = f.to ?? env.today
    const tb = await trialBalance(db, { from: f.from, to, excludeClosing: f.status === 'exclude', includeZero: f.kind === 'all' })
    const rows: Row[] = []
    let type = ''
    for (const r of tb.rows) {
      if (r.type !== type) {
        type = r.type
        rows.push({ _style: 'section', code: '', name: ACCOUNT_TYPE[type] ?? type })
      }
      rows.push({
        _style: 'item',
        accountId: r.id,
        code: r.code,
        name: r.name,
        openingDebit: r.openingDebit.toString(),
        openingCredit: r.openingCredit.toString(),
        periodDebit: r.periodDebit.toString(),
        periodCredit: r.periodCredit.toString(),
        closingDebit: r.closingDebit.toString(),
        closingCredit: r.closingCredit.toString(),
      })
    }
    const t = tb.totals
    return {
      columns: [
        { key: 'code', header: 'الرمز', width: 10, href: ledgerHref },
        { key: 'name', header: 'الحساب', width: 34, href: ledgerHref },
        { key: 'openingDebit', header: 'افتتاحي مدين', type: 'money' },
        { key: 'openingCredit', header: 'افتتاحي دائن', type: 'money' },
        { key: 'periodDebit', header: 'حركة مدينة', type: 'money' },
        { key: 'periodCredit', header: 'حركة دائنة', type: 'money' },
        { key: 'closingDebit', header: 'ختامي مدين', type: 'money' },
        { key: 'closingCredit', header: 'ختامي دائن', type: 'money' },
      ],
      rows,
      totals: {
        code: '',
        name: 'الإجمالي',
        openingDebit: t.openingDebit.toString(),
        openingCredit: t.openingCredit.toString(),
        periodDebit: t.periodDebit.toString(),
        periodCredit: t.periodCredit.toString(),
        closingDebit: t.closingDebit.toString(),
        closingCredit: t.closingCredit.toString(),
      },
      summary: [
        { label: 'مجموع الأرصدة المدينة', value: t.closingDebit.toString(), type: 'money' },
        { label: 'مجموع الأرصدة الدائنة', value: t.closingCredit.toString(), type: 'money' },
        { label: 'الحالة', value: tb.balanced ? 'متوازن ✓' : 'غير متوازن ✗', type: 'text' },
      ],
      note: 'الرصيد الافتتاحي = كل الحركات قبل بداية الفترة. الحسابات التجميعية لا تظهر هنا (أرصدتها مجموع فروعها في دليل الحسابات).',
    }
  },
}

function sectionRows(title: string, section: { rows: SectionRow[]; total: { toString(): string } }, totalLabel: string): Row[] {
  return [
    { _style: 'section', code: '', name: title, amount: null },
    ...section.rows.map((r) => ({
      _style: r.isGroup ? 'subtotal' : 'item',
      accountId: r.isGroup ? null : r.id,
      code: r.code,
      name: `${indent(r.depth)}${r.name}`,
      amount: r.amount.toString(),
    })),
    { _style: 'subtotal', code: '', name: totalLabel, amount: section.total.toString() },
  ]
}

export const balanceSheetReport: ReportDef = {
  id: 'balance-sheet',
  title: 'الميزانية العمومية',
  description: 'الأصول = الالتزامات + حقوق الملكية + صافي ربح السنوات غير المقفلة، في تاريخ نهاية الفترة.',
  group: 'accounting',
  permissions: ['accounting.view'],
  filters: [{ key: 'period', defaultPeriod: 'year', label: 'حتى نهاية الفترة' }, { key: 'year' }],
  async run(f, env) {
    const asOf = f.to && f.to < env.today ? f.to : env.today
    const bs = await balanceSheet(db, { asOf })
    const rows: Row[] = [
      ...sectionRows('الأصول', bs.assets, 'إجمالي الأصول'),
      ...sectionRows('الالتزامات', bs.liabilities, 'إجمالي الالتزامات'),
      ...sectionRows('حقوق الملكية', bs.equity, 'إجمالي حقوق الملكية'),
      { _style: 'item', code: '', name: bs.unclosedIncome.isNegative() ? 'صافي خسارة السنوات غير المقفلة' : 'صافي ربح السنوات غير المقفلة', amount: bs.unclosedIncome.toString() },
      { _style: 'total', code: '', name: 'إجمالي الالتزامات وحقوق الملكية', amount: bs.totalLiabilitiesEquity.toString() },
    ]
    return {
      columns: [
        { key: 'code', header: 'الرمز', width: 10, href: ledgerHref },
        { key: 'name', header: 'البند', width: 46, href: ledgerHref },
        { key: 'amount', header: 'المبلغ', type: 'money' },
      ],
      rows,
      summary: [
        { label: 'التاريخ', value: asOf, type: 'text' },
        { label: 'إجمالي الأصول', value: bs.assets.total.toString(), type: 'money' },
        { label: 'الالتزامات وحقوق الملكية', value: bs.totalLiabilitiesEquity.toString(), type: 'money' },
        { label: 'الحالة', value: bs.balanced ? 'متوازنة ✓' : 'غير متوازنة ✗', type: 'text' },
      ],
      note: 'صافي ربح السنوات غير المقفلة ينتقل إلى الأرباح المحتجزة (وحصص الشركاء) عند إقفال السنة.',
    }
  },
}
