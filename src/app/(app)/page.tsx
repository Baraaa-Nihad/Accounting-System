import Link from 'next/link'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, HandCoins, Info, Plus, Receipt, UserPlus, Users, Wallet } from 'lucide-react'
import { requirePermission, can, canSeeSalaries } from '@/server/auth/guard'
import { getSelectedYear } from '@/server/context-year'
import { getFormatConfig } from '@/server/settings'
import { dashboardData, latestDocuments } from '@/server/services/dashboard'
import { boxAccess, cashAccountsSummary } from '@/server/services/treasury'
import { db } from '@/server/db'
import { getAlerts } from '@/server/services/alerts'
import { makeFormatters } from '@/lib/format-jsx'
import { formatNumber } from '@/lib/format'
import { ARABIC_MONTHS, parts, toDateOnly } from '@/lib/dates'
import { DOC_STATUS, RECEIPT_KIND, VOUCHER_KIND } from '@/lib/labels'
import { D, sum } from '@/lib/money'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { StatusBadge } from '@/components/ui/badge'
import { MonthlyChart } from '@/components/dashboard/monthly-chart'
import { BarList, MeterList } from '@/components/dashboard/bar-list'

export const metadata = { title: 'الرئيسية' }

export default async function DashboardPage() {
  const user = await requirePermission('dashboard.view')
  const selected = await getSelectedYear()
  const year = selected ? { id: selected.id, name: selected.name, startDate: toDateOnly(selected.startDate), endDate: toDateOnly(selected.endDate) } : null
  const [fmt, data, alerts, latest, access] = await Promise.all([
    getFormatConfig(),
    dashboardData(year),
    getAlerts(user),
    latestDocuments(6),
    boxAccess(db, user.id, user.permissions),
  ])
  const f = makeFormatters(fmt)
  // صندوق العهدة: يظهر لصاحبه بدل رصيد كل الصناديق إذا كان مقيّدًا به أو لا يرى الخزينة
  const myBoxes = access.own.length ? (await cashAccountsSummary(db)).filter((a) => a.isActive && access.own.includes(a.id)) : []
  const { m: month } = parts(data.today)
  const show = {
    students: can(user, 'charges.view'),
    receipts: can(user, 'receipts.view'),
    vouchers: can(user, 'vouchers.view'),
    expenses: can(user, 'expenses.view'),
    salaries: canSeeSalaries(user),
    treasury: can(user, 'treasury.view'),
  }
  const y = data.year
  const rate = y && D(y.charged).greaterThan(0) ? D(y.paid).dividedBy(D(y.charged)).times(100) : null
  const net = D(data.receiptsThisMonth.amount).minus(D(data.vouchersThisMonth.amount))

  const yearRows = y
    ? [
        show.students && { label: 'المطلوب من الطلاب', value: f.money(y.charged), hint: 'بعد الخصومات' },
        show.students && { label: 'المحصل من الذمم', value: f.money(y.paid), hint: rate ? `نسبة التحصيل ${rate.toFixed(1)}%` : undefined },
        show.students && { label: 'الخصومات والإعفاءات', value: f.money(y.discounts) },
        show.expenses && { label: 'المصروفات', value: f.money(y.expenses), href: '/expenses' },
        show.salaries && { label: 'منها الرواتب', value: f.money(y.salaries), href: '/payroll' },
      ].filter(Boolean)
    : []
  const monthRows = [
    show.students && { label: 'المستحق هذا الشهر', value: f.money(data.dueThisMonth.amount), hint: `${data.dueThisMonth.installments} قسط غير مسدد` },
    show.students && { label: 'الطلاب المدينون', value: f.number(data.outstanding.students), href: '/charges?tab=due' },
    show.receipts && { label: 'القبض هذا الشهر', value: f.money(data.receiptsThisMonth.amount), hint: `${data.receiptsThisMonth.count} سند`, href: '/receipts' },
    show.vouchers && { label: 'الصرف هذا الشهر', value: f.money(data.vouchersThisMonth.amount), hint: `${data.vouchersThisMonth.count} سند`, href: '/vouchers' },
    show.receipts && show.vouchers && { label: 'صافي الحركة', value: f.money(net, { colored: true }), hint: 'القبض − الصرف' },
    show.treasury && { label: 'رصيد البنوك', value: f.money(data.cash.banks), href: '/treasury' },
  ].filter(Boolean) as { label: string; value: React.ReactNode; hint?: string; href?: string }[]

  return (
    <>
      <PageHeader
        title={`أهلًا ${user.fullName}`}
        description={`ملخص الوضع المالي — ${f.dateText(data.today)}${year ? ` — السنة الدراسية ${year.name}` : ''}`}
        actions={
          <>
            {can(user, 'students.create') ? (
              <Button variant="secondary" asChild>
                <Link href="/students/new">
                  <UserPlus />
                  طالب جديد
                </Link>
              </Button>
            ) : null}
            {can(user, 'vouchers.create') ? (
              <Button variant="secondary" asChild>
                <Link href="/vouchers/new">
                  <ArrowUpRight />
                  سند صرف
                </Link>
              </Button>
            ) : null}
            {can(user, 'receipts.create') ? (
              <Button size="lg" asChild>
                <Link href="/receipts/new">
                  <Plus />
                  تسجيل دفعة
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* الصف الأول: أهم أربعة أرقام */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {show.students ? (
          <StatCard
            label="المتبقي على الطلاب"
            value={f.money(data.outstanding.amount)}
            hint={`على ${formatNumber(data.outstanding.students)} طالب — كل السنوات`}
            icon={<Users />}
            accent="brand"
            emphasis
            href="/charges?tab=due"
          />
        ) : null}
        {show.receipts ? (
          <StatCard
            label={`المحصل في ${ARABIC_MONTHS[month - 1]}`}
            value={f.money(data.collectedThisMonth.amount)}
            hint={`${formatNumber(data.collectedThisMonth.receipts)} سند قبض من الطلاب`}
            icon={<ArrowDownLeft />}
            accent="green"
            emphasis
            href="/receipts"
          />
        ) : null}
        {show.students ? (
          <StatCard
            label="الأقساط المتأخرة"
            value={f.money(data.overdue.amount)}
            hint={data.overdue.students ? `${formatNumber(data.overdue.students)} طالب — ${formatNumber(data.overdue.installments)} قسط` : 'لا توجد متأخرات'}
            icon={<CalendarClock />}
            accent={D(data.overdue.amount).greaterThan(0) ? 'red' : 'slate'}
            emphasis
            href="/charges?tab=overdue"
          />
        ) : null}
        {myBoxes.length && (access.restricted || !show.treasury) ? (
          <StatCard
            label="صندوقي"
            value={f.money(sum(myBoxes.map((b) => b.balance)))}
            hint={myBoxes.map((b) => b.name).join('، ')}
            icon={<Wallet />}
            accent="amber"
            emphasis
            href={show.treasury ? (myBoxes.length === 1 ? `/treasury/${myBoxes[0].id}` : '/treasury') : undefined}
          />
        ) : show.treasury ? (
          <StatCard label="رصيد الصناديق" value={f.money(data.cash.cashboxes)} hint={<>البنوك: {f.money(data.cash.banks)}</>} icon={<Wallet />} accent="amber" emphasis href="/treasury" />
        ) : null}
      </div>

      {/* الصف الثاني: السنة والشهر */}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {yearRows.length ? <SummaryCard title={`السنة الدراسية ${year?.name ?? ''}`} rows={yearRows as SummaryRow[]} /> : null}
        {monthRows.length ? <SummaryCard title={`شهر ${ARABIC_MONTHS[month - 1]}`} rows={monthRows} /> : null}
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        {y && show.receipts && show.expenses ? (
          <Card className="xl:col-span-2">
            <CardHeader title="التحصيل مقابل المصروفات" description={`لكل شهر من السنة الدراسية ${year?.name ?? ''} — المصروفات تشمل الرواتب والفواتير`} />
            <CardBody>
              <MonthlyChart data={y.monthly} />
            </CardBody>
          </Card>
        ) : null}
        <Card className={cn(!(y && show.receipts && show.expenses) && 'xl:col-span-3')}>
          <CardHeader
            title="التنبيهات"
            actions={
              <Link href="/notifications" className="text-sm text-brand-700 hover:underline">
                الكل
              </Link>
            }
          />
          {alerts.length === 0 ? (
            <CardBody>
              <p className="py-6 text-center text-sm text-slate-500">لا توجد تنبيهات الآن</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-slate-100">
              {alerts.slice(0, 7).map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
                        a.level === 'danger' ? 'bg-rose-50 text-rose-600' : a.level === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700',
                      )}
                    >
                      {a.level === 'info' ? <Info /> : <AlertTriangle />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{a.title}</span>
                      {a.description ? <span className="block text-xs text-slate-500">{a.description}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {y ? (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          {show.expenses ? (
            <Card>
              <CardHeader title="المصروفات حسب التصنيف" description={`السنة الدراسية ${year?.name ?? ''} — أعلى التصنيفات`} />
              <CardBody>
                <BarList
                  items={y.categories.map((c) => ({ key: String(c.accountId), name: c.name, value: c.total, href: c.accountId ? `/expenses?category=${c.accountId}` : undefined }))}
                  emptyText="لا توجد مصروفات مسجلة في هذه السنة"
                />
              </CardBody>
            </Card>
          ) : null}
          {show.students ? (
            <Card>
              <CardHeader title="نسبة التحصيل حسب الصف" description="المحصل من صافي ذمم السنة لطلاب كل صف" />
              <CardBody>
                <MeterList
                  items={y.grades.map((g) => ({ key: String(g.gradeId), name: g.name, value: g.paid, total: g.net, hint: `${g.students} طالب` }))}
                  emptyText="لا توجد ذمم مسجلة في هذه السنة"
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {show.receipts ? (
          <Card>
            <CardHeader
              title="آخر سندات القبض"
              actions={
                <Link href="/receipts" className="text-sm text-brand-700 hover:underline">
                  الكل
                </Link>
              }
            />
            <DocList
              empty="لا توجد سندات قبض بعد"
              rows={latest.receipts.map((r) => ({
                id: r.id,
                href: `/receipts/${r.id}`,
                number: r.number,
                who: r.payerName,
                kind: RECEIPT_KIND[r.kind],
                date: f.date(r.date),
                amount: f.money(r.amount),
                status: r.status,
              }))}
              icon={<Receipt />}
            />
          </Card>
        ) : null}
        {show.vouchers ? (
          <Card>
            <CardHeader
              title="آخر سندات الصرف"
              actions={
                <Link href="/vouchers" className="text-sm text-brand-700 hover:underline">
                  الكل
                </Link>
              }
            />
            <DocList
              empty="لا توجد سندات صرف بعد"
              rows={latest.vouchers.map((v) => ({
                id: v.id,
                href: `/vouchers/${v.id}`,
                number: v.number,
                who: v.payeeName,
                kind: VOUCHER_KIND[v.kind],
                date: f.date(v.date),
                amount: f.money(v.amount),
                status: v.status,
              }))}
              icon={<HandCoins />}
            />
          </Card>
        ) : null}
      </div>
    </>
  )
}


type SummaryRow = { label: string; value: React.ReactNode; hint?: string; href?: string }

function SummaryCard({ title, rows }: { title: string; rows: SummaryRow[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <dl className="grid grid-cols-2 sm:grid-cols-3">
        {rows.map((r, i) => {
          const body = (
            <>
              <dt className="text-xs text-slate-500">{r.label}</dt>
              <dd className="mt-0.5 text-lg font-bold text-slate-900">{r.value}</dd>
              {r.hint ? <dd className="text-[11px] text-slate-400">{r.hint}</dd> : null}
            </>
          )
          return (
            <div key={i} className="border-b border-s border-slate-100 px-5 py-3.5 [&:nth-child(3n+1)]:border-s-0 max-sm:[&:nth-child(2n+1)]:border-s-0">
              {r.href ? (
                <Link href={r.href} className="block hover:opacity-80">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          )
        })}
      </dl>
    </Card>
  )
}

function DocList({
  rows,
  empty,
  icon,
}: {
  rows: { id: number; href: string; number: string; who: string; kind: string; date: React.ReactNode; amount: React.ReactNode; status: string }[]
  empty: string
  icon: React.ReactNode
}) {
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-slate-500">{empty}</p>
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={r.href} className={cn('flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50', r.status === 'CANCELLED' && 'opacity-60')}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 [&_svg]:size-4">{icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{r.who}</span>
              <span className="block text-xs text-slate-500">
                <span className="num">{r.number}</span> · {r.kind} · {r.date}
              </span>
            </span>
            <span className="text-end text-sm font-semibold">
              {r.amount}
              {r.status === 'CANCELLED' ? (
                <span className="block">
                  <StatusBadge map={DOC_STATUS} value={r.status} />
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

