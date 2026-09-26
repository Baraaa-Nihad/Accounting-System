import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig, today as todayOf } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { categoryLines, categoryTotals } from '@/server/services/pnl'
import { makeFormatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { toDateOnly } from '@/lib/dates'
import { resolvePeriod } from '@/lib/period'
import { firstParam, intParam, withParams } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { PeriodFilter } from '@/components/ui/period-filter'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from '@/components/ui/table'
import { CategoryDialog } from '@/components/settings/types-client'
import { CategoryLines, ShareBar } from '@/components/pnl/category-lines'

export const metadata = { title: 'المصروفات' }

export default async function ExpensesPage({ searchParams }: PageProps<'/expenses'>) {
  const user = await requirePermission('expenses.view')
  const sp = await searchParams
  const [year, today] = await Promise.all([getSelectedYear(), todayOf()])
  const period = resolvePeriod(
    { period: firstParam(sp.period), from: firstParam(sp.from), to: firstParam(sp.to) },
    { today, year: year ? { startDate: toDateOnly(year.startDate), endDate: toDateOnly(year.endDate) } : null },
  )
  const { from, to } = period
  const accountId = intParam(sp.category)
  const [fmt, totals, lines] = await Promise.all([
    getFormatConfig(),
    categoryTotals(db, 'EXPENSE', { from, to }),
    categoryLines(db, { type: 'EXPENSE', accountId, from, to, q: firstParam(sp.q), hideReversed: firstParam(sp.rev) !== 'show', page: intParam(sp.page) }),
  ])
  const f = makeFormatters(fmt)
  const salaries = await db.account.findUnique({ where: { systemKey: 'SALARIES_EXPENSE' }, select: { id: true } })
  const total = sum(totals.map((t) => t.total))
  const salaryTotal = D(totals.find((t) => t.accountId === salaries?.id)?.total ?? 0)
  const used = totals.filter((t) => !D(t.total).isZero())
  const manage = can(user, 'expenses.manage')
  const shown = totals.filter((t) => t.isActive || !D(t.total).isZero())
    .sort((a, b) => (D(a.total).isZero() === D(b.total).isZero() ? (D(a.total).isZero() ? a.code.localeCompare(b.code) : D(b.total).comparedTo(D(a.total))) : D(a.total).isZero() ? 1 : -1))

  return (
    <>
      <PageHeader
        title="المصروفات"
        description="كل مصروفات المدرسة حسب التصنيف: سندات الصرف، فواتير الموردين، أعمال المقاولين، والرواتب. الفترة الافتراضية هي السنة الدراسية المختارة."
        actions={
          <>
            {manage ? <CategoryDialog kind="EXPENSE" /> : null}
            {can(user, 'vouchers.create') ? (
              <Button size="lg" asChild>
                <Link href="/vouchers/new?kind=EXPENSE">
                  <Plus />
                  مصروف جديد
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="card mb-5 overflow-hidden">
        <PeriodFilter current={period} />
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي المصروفات للفترة" value={f.money(total)} accent="red" emphasis />
        <StatCard label="منها الرواتب والأجور" value={f.money(salaryTotal)} accent="violet" />
        <StatCard label="المصروفات التشغيلية والأخرى" value={f.money(total.minus(salaryTotal))} accent="amber" />
      </div>
      <Card className="mb-5 overflow-hidden">
        <CardHeader title="المصروفات حسب التصنيف" description={`${used.length} تصنيف عليه حركات في الفترة`} />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>التصنيف</TH>
                <TH numeric>المبلغ</TH>
                <TH>النسبة</TH>
                <TH numeric>الحركات</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {shown.map((t) => (
                <TR key={t.accountId} className={D(t.total).isZero() ? 'text-slate-400' : undefined}>
                  <TD>
                    <Link href={withParams('/expenses', sp, { category: String(t.accountId), page: null })} className="font-medium hover:text-brand-700">
                      {t.name}
                    </Link>
                    <span className="num ms-2 text-xs text-slate-400">{t.code}</span>
                    {!t.isActive ? <Badge className="ms-2">معطل</Badge> : null}
                  </TD>
                  <TD numeric className="font-semibold">
                    {f.money(t.total, { hideZero: true })}
                  </TD>
                  <TD>{!D(t.total).isZero() ? <ShareBar value={t.total} total={total.toString()} tone="bg-rose-400" /> : null}</TD>
                  <TD numeric>{t.count ? f.number(t.count) : '—'}</TD>
                  <TD>
                    {manage && !t.systemKey ? (
                      <CategoryDialog kind="EXPENSE" initial={{ id: t.accountId, name: t.name, isActive: t.isActive, description: t.description ?? '', system: false }} />
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <TFootRow>
                <TD>الإجمالي</TD>
                <TD numeric>{f.money(total)}</TD>
                <TD colSpan={3} />
              </TFootRow>
            </tfoot>
          </Table>
        </TableWrap>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader
          title="الحركات التفصيلية"
          description="كل حركة مرتبطة بمستندها (سند صرف، فاتورة مورد، عمل مقاول، مسير رواتب)."
        />
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'البيان أو رقم القيد...' },
            { type: 'select', name: 'category', label: 'التصنيف', options: totals.map((t) => ({ value: String(t.accountId), label: t.name })) },
            { type: 'select', name: 'rev', label: 'الحركات الملغاة', allLabel: 'مخفية', options: [{ value: 'show', label: 'إظهار' }] },
          ]}
        />
        <CategoryLines data={lines} f={f} path="/expenses" params={sp} emptyText="لا توجد مصروفات مسجلة في هذه الفترة." />
      </Card>
    </>
  )
}
