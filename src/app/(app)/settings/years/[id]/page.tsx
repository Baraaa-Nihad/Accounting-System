import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { closingPreview } from '@/server/services/year-closing'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { ADMIN_ROLE_KEY } from '@/lib/permissions'
import { YEAR_STATUS } from '@/lib/labels'
import { D } from '@/lib/money'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { CloseYearPanel, ReopenYearButton } from '@/components/settings/year-closing'

export const metadata = { title: 'السنة الدراسية' }

export default async function YearPage({ params }: PageProps<'/settings/years/[id]'>) {
  const user = await requirePermission('years.manage')
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const exists = await db.academicYear.findUnique({ where: { id }, select: { id: true } })
  if (!exists) notFound()
  const [fmt, p] = await Promise.all([getFormatConfig(), closingPreview(db, id)])
  const f = makeFormatters(fmt)
  const open = p.year.status === 'OPEN'
  return (
    <>
      <PageHeader
        title={`السنة الدراسية ${p.year.name}`}
        breadcrumbs={[{ label: 'الإعدادات', href: '/settings' }, { label: 'السنوات الدراسية', href: '/settings/years' }, { label: p.year.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {f.date(p.year.startDate)} ← {f.date(p.year.endDate)}
            <StatusBadge map={YEAR_STATUS} value={p.year.status} />
            {p.year.isCurrent ? <Badge tone="teal">الحالية</Badge> : null}
            {p.year.closedAt ? <span className="text-slate-500">أُغلقت في {f.dateTime(p.year.closedAt)}</span> : null}
          </span>
        }
        actions={!open && user.roleKey === ADMIN_ROLE_KEY ? <ReopenYearButton yearId={p.year.id} yearName={p.year.name} /> : null}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="إيرادات السنة (بعد الخصومات)" value={f.money(p.revenue.toString())} />
        <StatCard label="مصروفات السنة" value={f.money(p.expenses.toString())} accent="amber" />
        <StatCard label={p.netIncome.isNegative() ? 'صافي الخسارة' : 'صافي الربح'} value={f.money(p.netIncome.abs().toString())} accent={p.netIncome.isNegative() ? 'red' : 'green'} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {open ? (
            <Card>
              <CardHeader title="قبل الإغلاق" description="راجع التنبيهات، ثم أغلق السنة. يمكن لمدير النظام إعادة فتحها لاحقًا مع سبب." />
              <CardBody className="space-y-2">
                {p.warnings.length ? (
                  p.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      {w}
                    </p>
                  ))
                ) : (
                  <p className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    لا توجد تنبيهات.
                  </p>
                )}
              </CardBody>
            </Card>
          ) : null}
          <Card className="overflow-hidden">
            <CardHeader
              title={open ? 'قيد الإقفال المتوقع' : 'نتيجة السنة (قبل الإقفال)'}
              description="تصفير أرصدة الإيرادات والمصروفات للسنة، والفرق إلى الأرباح المحتجزة."
            />
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>الحساب</TH>
                    <TH numeric>رصيد السنة</TH>
                  </tr>
                </THead>
                <tbody>
                  {p.balances.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link href={`/accounting/ledger?account=${b.id}&from=${p.year.startDate}&to=${p.year.endDate}`} className="hover:text-brand-700 hover:underline">
                          <span className="num text-slate-500">{b.code}</span> {b.name}
                        </Link>
                      </TD>
                      <TD numeric>{f.money(b.type === 'REVENUE' ? b.net.negated().toString() : b.net.toString(), { colored: true })}</TD>
                    </TR>
                  ))}
                  <TR className="bg-slate-50 font-semibold">
                    <TD>{p.netIncome.isNegative() ? 'صافي الخسارة إلى الأرباح المحتجزة' : 'صافي الربح إلى الأرباح المحتجزة'}</TD>
                    <TD numeric>{f.money(p.netIncome.toString(), { colored: true })}</TD>
                  </TR>
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </div>
        <div className="space-y-5">
          {open ? (
            <Card>
              <CardHeader title="إغلاق السنة" />
              <CardBody>
                <CloseYearPanel
                  yearId={p.year.id}
                  yearName={p.year.name}
                  canDistribute={p.partners.length > 0 && !p.netIncome.isZero()}
                  canMoveCurrent={p.year.isCurrent && !!p.next && p.next.status === 'OPEN'}
                  nextName={p.next?.name ?? null}
                />
              </CardBody>
            </Card>
          ) : null}
          {p.partners.length ? (
            <Card className="overflow-hidden">
              <CardHeader title="حصص الشركاء" description={`مجموع النسب ${p.partnersPercent.toString()}%${D(p.partnersPercent).lessThan(100) ? ' — الباقي يبقى في الأرباح المحتجزة' : ''}`} />
              <ul className="divide-y divide-slate-100 text-sm">
                {p.partners.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-5 py-2.5">
                    <span>
                      {s.name} <span className="text-slate-400">({s.percent.toString()}%)</span>
                    </span>
                    {f.money(p.netIncome.isNegative() ? s.amount.negated().toString() : s.amount.toString(), { colored: true })}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {p.closeEntries.length ? (
            <Card className="overflow-hidden">
              <CardHeader title="قيود الإقفال" />
              <ul className="divide-y divide-slate-100 text-sm">
                {p.closeEntries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-5 py-2.5">
                    <Link href={`/accounting/journal/${e.id}`} className="num text-brand-700 hover:underline">
                      {e.number}
                    </Link>
                    {e.status === 'REVERSED' ? <Badge tone="gray">معكوس</Badge> : <Badge tone="green">مرحّل</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  )
}
