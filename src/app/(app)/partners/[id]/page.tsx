import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listPartners } from '@/server/services/partners'
import { statementTarget } from '@/server/ledger/party-statements'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { isDateOnly, toDateOnly } from '@/lib/dates'
import { cn, firstParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatementView } from '@/components/ledger/statement-view'
import { PartnerDialog } from '@/components/users/partner-dialog'

export const metadata = { title: 'شريك' }

export default async function PartnerPage({ params, searchParams }: PageProps<'/partners/[id]'>) {
  const user = await requirePermission('partners.manage', 'reports.financial')
  const id = Number((await params).id)
  const sp = await searchParams
  if (!Number.isInteger(id) || id <= 0) notFound()
  const manage = can(user, 'partners.manage')
  const [fmt, partners, users, target] = await Promise.all([
    getFormatConfig(),
    listPartners(db),
    manage ? db.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, username: true } }) : [],
    statementTarget(db, 'partner', id),
  ])
  const p = partners.find((x) => x.id === id)
  if (!p || !target) notFound()
  const f = makeFormatters(fmt)
  const othersAllocated = sum(partners.filter((x) => x.isActive && x.id !== p.id).map((x) => D(x.ownershipPercent)))
  return (
    <>
      <PageHeader
        title={p.name}
        breadcrumbs={[{ label: 'الشركاء', href: '/partners' }, { label: p.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            نسبة الملكية <bdi className="ltr num font-semibold text-slate-700">{p.ownershipPercent.toString()}%</bdi>
            {p.phone ? (
              <>
                <span className="text-slate-300">·</span>
                <bdi className="ltr">{p.phone}</bdi>
              </>
            ) : null}
            {p.isActive ? null : <Badge>غير فعال</Badge>}
            {p.capitalAccount && p.drawingsAccount ? (
              <span className="text-xs text-slate-400">
                (الحسابات <bdi className="num">{p.capitalAccount.code}</bdi> و<bdi className="num">{p.drawingsAccount.code}</bdi>)
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            {can(user, 'receipts.create') && p.isActive ? (
              <Button variant="secondary" asChild>
                <Link href={`/receipts/new?mode=partner&partnerId=${p.id}`}>
                  <ArrowDownToLine />
                  إيداع رأس مال
                </Link>
              </Button>
            ) : null}
            {can(user, 'vouchers.create') && p.isActive ? (
              <Button variant="secondary" asChild>
                <Link href={`/vouchers/new?kind=PARTNER_WITHDRAWAL&partnerId=${p.id}`}>
                  <ArrowUpFromLine />
                  سحب
                </Link>
              </Button>
            ) : null}
            {manage ? (
              <PartnerDialog
                users={users.map((u) => ({ id: u.id, label: `${u.fullName} (${u.username})` }))}
                remainingPercent={D(100).minus(othersAllocated).toString()}
                initial={{
                  id: p.id,
                  name: p.name,
                  phone: p.phone ?? '',
                  email: p.email ?? '',
                  ownershipPercent: p.ownershipPercent.toString(),
                  userId: p.userId ? String(p.userId) : '',
                  joinDate: p.joinDate ? toDateOnly(p.joinDate) : '',
                  notes: p.notes ?? '',
                  isActive: p.isActive,
                }}
              />
            ) : null}
          </>
        }
      />
      <div className="card mb-5 grid grid-cols-1 sm:grid-cols-3">
        {[
          { label: 'رأس المال المدفوع', value: f.money(p.capital), cls: '' },
          { label: 'المسحوبات', value: f.money(p.withdrawals), cls: 'text-amber-700' },
          { label: 'صافي الحقوق', value: f.money(p.equity), cls: p.equity.isNegative() ? 'text-rose-600' : 'text-emerald-700' },
        ].map((x, i) => (
          <div key={i} className={cn('border-slate-100 px-5 py-4', i > 0 && 'border-t sm:border-s sm:border-t-0')}>
            <p className="text-xs text-slate-500">{x.label}</p>
            <p className={cn('mt-0.5 text-xl font-bold', x.cls)}>{x.value}</p>
          </div>
        ))}
      </div>
      <StatementView
        target={target}
        from={isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null}
        to={isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null}
        hideReversed={firstParam(sp.hide) === '1'}
        f={f}
        canExport={can(user, 'reports.export')}
      />
    </>
  )
}
