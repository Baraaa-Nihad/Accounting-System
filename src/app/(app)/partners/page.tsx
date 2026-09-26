import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listPartners } from '@/server/services/partners'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { toDateOnly } from '@/lib/dates'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { AdminTabs } from '@/components/users/admin-tabs'
import { PartnerDialog } from '@/components/users/partner-dialog'

export const metadata = { title: 'الشركاء' }

export default async function PartnersPage() {
  const user = await requirePermission('partners.manage', 'reports.financial')
  const manage = can(user, 'partners.manage')
  const [fmt, partners, users] = await Promise.all([
    getFormatConfig(),
    listPartners(db),
    manage ? db.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, username: true } }) : [],
  ])
  const f = makeFormatters(fmt)
  const active = partners.filter((p) => p.isActive)
  const allocated = sum(active.map((p) => D(p.ownershipPercent)))
  const remaining = D(100).minus(allocated)
  return (
    <>
      <PageHeader
        title="الشركاء"
        description="لكل شريك حساب رأس مال وحساب جارٍ. الإيداع بسند قبض «رأس مال شريك»، والسحب بسند صرف «سحب شريك»، وحصة كل شريك من الربح حسب نسبته تظهر في تقرير الأرباح والخسائر."
        actions={manage ? <PartnerDialog users={users.map((u) => ({ id: u.id, label: `${u.fullName} (${u.username})` }))} remainingPercent={remaining.toString()} /> : null}
      />
      {can(user, 'users.manage') || manage ? <AdminTabs active="partners" canUsers={can(user, 'users.manage')} canPartners={manage} /> : null}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="رأس المال المدفوع" value={f.money(sum(partners.map((p) => p.capital)))} />
        <StatCard label="مسحوبات الشركاء" value={f.money(sum(partners.map((p) => p.withdrawals)))} accent="amber" />
        <StatCard label="صافي حقوق الشركاء" value={f.money(sum(partners.map((p) => p.equity)))} accent="green" />
        <StatCard label="نسب الملكية الموزعة" value={<bdi className="ltr num">{allocated.toString()}%</bdi>} accent={allocated.equals(100) ? 'green' : 'amber'} />
      </div>
      <div className="card overflow-hidden">
        {partners.length === 0 ? (
          <EmptyState title="لا يوجد شركاء مسجلون" description="أضف الشركاء ونسب ملكيتهم ليُنشأ لكل منهم حساب رأس مال وحساب جارٍ." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الشريك</TH>
                  <TH numeric>نسبة الملكية</TH>
                  <TH numeric>رأس المال</TH>
                  <TH numeric>المسحوبات</TH>
                  <TH numeric>صافي الحقوق</TH>
                  <TH>حساب الدخول</TH>
                  <TH>منذ</TH>
                </tr>
              </THead>
              <tbody>
                {partners.map((p) => (
                  <TR key={p.id} className={p.isActive ? undefined : 'opacity-60'}>
                    <TD>
                      <Link href={`/partners/${p.id}`} className="font-medium text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                      {p.isActive ? null : <Badge className="ms-2">غير فعال</Badge>}
                    </TD>
                    <TD numeric>
                      <bdi className="ltr num">{p.ownershipPercent.toString()}%</bdi>
                    </TD>
                    <TD numeric>{f.money(p.capital)}</TD>
                    <TD numeric>{f.money(p.withdrawals, { hideZero: true })}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(p.equity, { colored: true })}
                    </TD>
                    <TD>{p.user ? <bdi className="ltr">{p.user.username}</bdi> : <span className="text-slate-400">—</span>}</TD>
                    <TD>{p.joinDate ? f.date(toDateOnly(p.joinDate)) : '—'}</TD>
                  </TR>
                ))}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD>الإجمالي</TD>
                  <TD numeric>
                    <bdi className="ltr num">{allocated.toString()}%</bdi>
                  </TD>
                  <TD numeric>{f.money(sum(partners.map((p) => p.capital)))}</TD>
                  <TD numeric>{f.money(sum(partners.map((p) => p.withdrawals)))}</TD>
                  <TD numeric>{f.money(sum(partners.map((p) => p.equity)))}</TD>
                  <TD />
                  <TD />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
        )}
      </div>
    </>
  )
}
