import Link from 'next/link'
import { Plus, Settings2 } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig, today as todayOf } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { categoryLines, categoryTotals, type CategoryTotal } from '@/server/services/pnl'
import { accountByKey } from '@/server/ledger/accounts'
import { makeFormatters, type Formatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { fromDateOnly, toDateOnly } from '@/lib/dates'
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

export const metadata = { title: 'الإيرادات' }

export default async function RevenuesPage({ searchParams }: PageProps<'/revenues'>) {
  const user = await requirePermission('revenues.view')
  const sp = await searchParams
  const [year, today] = await Promise.all([getSelectedYear(), todayOf()])
  const period = resolvePeriod(
    { period: firstParam(sp.period), from: firstParam(sp.from), to: firstParam(sp.to) },
    { today, year: year ? { startDate: toDateOnly(year.startDate), endDate: toDateOnly(year.endDate) } : null },
  )
  const { from, to } = period
  const [fmt, totals, lines, studentGroup, otherGroup, collected] = await Promise.all([
    getFormatConfig(),
    categoryTotals(db, 'REVENUE', { from, to }),
    categoryLines(db, { type: 'REVENUE', accountId: intParam(sp.category), from, to, q: firstParam(sp.q), hideReversed: firstParam(sp.rev) !== 'show', page: intParam(sp.page) }),
    accountByKey(db, 'STUDENT_REVENUE_GROUP'),
    accountByKey(db, 'OTHER_REVENUE_GROUP'),
    db.receipt.aggregate({
      where: {
        status: 'ACTIVE',
        kind: { in: ['STUDENT', 'FAMILY'] },
        ...(from || to ? { date: { ...(from ? { gte: fromDateOnly(from) } : {}), ...(to ? { lte: fromDateOnly(to) } : {}) } } : {}),
      },
      _sum: { amount: true },
    }),
  ])
  const f = makeFormatters(fmt)
  const student = totals.filter((t) => t.code.startsWith(studentGroup.code) && t.systemKey !== 'DISCOUNTS_ALLOWED')
  const other = totals.filter((t) => t.code.startsWith(otherGroup.code))
  const discounts = totals.filter((t) => t.systemKey === 'DISCOUNTS_ALLOWED')
  const rest = totals.filter((t) => !student.includes(t) && !other.includes(t) && !discounts.includes(t))
  const studentTotal = sum(student.map((t) => t.total))
  const otherTotal = sum([...other, ...rest].map((t) => t.total))
  const discountTotal = sum(discounts.map((t) => t.total)).negated()
  const net = sum(totals.map((t) => t.total))

  return (
    <>
      <PageHeader
        title="الإيرادات"
        description="إيرادات الرسوم الدراسية حسب نوع الذمة (بعد الخصومات)، والإيرادات الأخرى كالتبرعات. الفترة الافتراضية هي السنة الدراسية المختارة."
        actions={
          <>
            {can(user, 'revenues.manage') ? (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/settings/charge-types">
                    <Settings2 />
                    تصنيفات الذمم
                  </Link>
                </Button>
                <CategoryDialog kind="OTHER_REVENUE" />
              </>
            ) : null}
            {can(user, 'receipts.create') ? (
              <Button size="lg" asChild>
                <Link href="/receipts/new?mode=revenue">
                  <Plus />
                  إيراد آخر
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="card mb-5 overflow-hidden">
        <PeriodFilter current={period} />
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="إيرادات الرسوم الدراسية" value={f.money(studentTotal)} accent="green" hint="قيمة الذمم المسجلة على الطلاب" />
        <StatCard label="الخصومات والإعفاءات" value={f.money(discountTotal)} accent="amber" />
        <StatCard label="إيرادات أخرى" value={f.money(otherTotal)} accent="blue" />
        <StatCard label="صافي الإيرادات" value={f.money(net)} accent="brand" emphasis hint={<>المحصّل فعليًا من الطلاب في الفترة: {f.money(D(collected._sum.amount))}</>} />
      </div>
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <RevenueTable title="الرسوم الدراسية حسب نوع الذمة" rows={student} total={studentTotal.toString()} f={f} sp={sp} manage={false} />
        <div className="space-y-5">
          <RevenueTable title="الإيرادات الأخرى" rows={[...other, ...rest]} total={otherTotal.toString()} f={f} sp={sp} manage={can(user, 'revenues.manage')} />
          <Card className="overflow-hidden">
            <CardHeader title="الخصومات والإعفاءات الممنوحة" description="تُطرح من إيرادات الرسوم" />
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-slate-600">إجمالي الخصومات في الفترة</span>
              <span className="text-lg font-bold text-amber-700">{f.money(discountTotal)}</span>
            </div>
          </Card>
        </div>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="الحركات التفصيلية" description="ذمم الطلاب والخصومات والإيرادات الأخرى، كل حركة مرتبطة بمستندها." />
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'البيان أو رقم القيد...' },
            { type: 'select', name: 'category', label: 'التصنيف', options: totals.map((t) => ({ value: String(t.accountId), label: t.name })) },
            { type: 'select', name: 'rev', label: 'الحركات الملغاة', allLabel: 'مخفية', options: [{ value: 'show', label: 'إظهار' }] },
          ]}
        />
        <CategoryLines data={lines} f={f} path="/revenues" params={sp} emptyText="لا توجد إيرادات مسجلة في هذه الفترة." />
      </Card>
    </>
  )
}

function RevenueTable({
  title,
  rows,
  total,
  f,
  sp,
  manage,
}: {
  title: string
  rows: CategoryTotal[]
  total: string
  f: Formatters
  sp: Record<string, string | string[] | undefined>
  manage: boolean
}) {
  const shown = rows.filter((t) => t.isActive || !D(t.total).isZero())
    .sort((a, b) => (D(a.total).isZero() === D(b.total).isZero() ? (D(a.total).isZero() ? a.code.localeCompare(b.code) : D(b.total).comparedTo(D(a.total))) : D(a.total).isZero() ? 1 : -1))
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التصنيف</TH>
              <TH numeric>المبلغ</TH>
              <TH>النسبة</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 ? (
              <TR>
                <TD colSpan={4} className="py-6 text-center text-slate-500">
                  لا توجد تصنيفات
                </TD>
              </TR>
            ) : (
              shown.map((t) => (
                <TR key={t.accountId} className={D(t.total).isZero() ? 'text-slate-400' : undefined}>
                  <TD>
                    <Link href={withParams('/revenues', sp, { category: String(t.accountId), page: null })} className="font-medium hover:text-brand-700">
                      {t.name}
                    </Link>
                    {!t.isActive ? <Badge className="ms-2">معطل</Badge> : null}
                  </TD>
                  <TD numeric className="font-semibold">
                    {f.money(t.total, { hideZero: true })}
                  </TD>
                  <TD>{!D(t.total).isZero() ? <ShareBar value={t.total} total={total} tone="bg-emerald-500" /> : null}</TD>
                  <TD>
                    {manage && !t.systemKey ? (
                      <CategoryDialog kind="OTHER_REVENUE" initial={{ id: t.accountId, name: t.name, isActive: t.isActive, description: t.description ?? '', system: false }} />
                    ) : null}
                  </TD>
                </TR>
              ))
            )}
          </tbody>
          <tfoot>
            <TFootRow>
              <TD>الإجمالي</TD>
              <TD numeric>{f.money(total)}</TD>
              <TD colSpan={2} />
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>
    </Card>
  )
}
