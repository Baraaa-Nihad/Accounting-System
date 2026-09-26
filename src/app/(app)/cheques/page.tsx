import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { LinkTabs } from '@/components/ui/link-tabs'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { ChequeActions } from '@/components/receipts/cheque-actions'
import { CHEQUE_STATUS } from '@/lib/labels'
import { firstParam } from '@/lib/utils'
import { D, sum } from '@/lib/money'
import { todayInTimeZone, toDateOnly } from '@/lib/dates'
import type { ChequeStatus } from '@/generated/prisma/enums'

export const metadata = { title: 'الشيكات' }

export default async function ChequesPage({ searchParams }: PageProps<'/cheques'>) {
  const user = await requirePermission('receipts.view', 'vouchers.view', 'cheques.manage')
  const sp = await searchParams
  const direction = firstParam(sp.direction) === 'OUTGOING' ? 'OUTGOING' : 'INCOMING'
  const status = firstParam(sp.status) as ChequeStatus | undefined
  const [fmt, settings, banks] = await Promise.all([
    getFormatConfig(),
    getSettings(),
    db.cashAccount.findMany({ where: { type: 'BANK', isActive: true }, orderBy: { name: 'asc' } }),
  ])
  const f = makeFormatters(fmt)
  const today = todayInTimeZone(settings.finance.timezone)
  const cheques = await db.cheque.findMany({
    where: {
      direction,
      ...(status ? { status } : direction === 'INCOMING' ? { status: 'IN_PORTFOLIO' } : {}),
    },
    include: {
      receipt: { select: { id: true, number: true, payerName: true } },
      voucher: { select: { id: true, number: true, payeeName: true } },
      depositAccount: { select: { name: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: 500,
  })
  const inPortfolio = await db.cheque.aggregate({ where: { direction: 'INCOMING', status: 'IN_PORTFOLIO' }, _sum: { amount: true }, _count: true })
  const dueSoon = cheques.filter((c) => c.status === 'IN_PORTFOLIO' && toDateOnly(c.dueDate) <= today)
  return (
    <>
      <PageHeader title="الشيكات" description="الشيكات الواردة من أولياء الأمور (حافظة الشيكات) والشيكات الصادرة للموردين والمقاولين." />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="شيكات في الحافظة" value={f.number(inPortfolio._count)} />
        <StatCard label="قيمة الشيكات في الحافظة" value={f.money(inPortfolio._sum.amount)} accent="amber" />
        <StatCard label="حلّ موعدها ولم تُحصّل" value={f.number(dueSoon.length)} accent="red" />
      </div>
      <LinkTabs
        className="mb-4"
        active={direction}
        tabs={[
          { key: 'INCOMING', label: 'الشيكات الواردة', href: '/cheques' },
          { key: 'OUTGOING', label: 'الشيكات الصادرة', href: '/cheques?direction=OUTGOING' },
        ]}
      />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            {
              type: 'select',
              name: 'status',
              label: 'الحالة',
              allLabel: direction === 'INCOMING' ? 'في الحافظة' : 'الكل',
              options: Object.entries(CHEQUE_STATUS)
                .filter(([k]) => (direction === 'INCOMING' ? k !== 'ISSUED' && k !== 'IN_PORTFOLIO' : k === 'ISSUED' || k === 'CLEARED' || k === 'CANCELLED'))
                .map(([k, v]) => ({ value: k, label: v.label })),
            },
          ]}
        />
        {cheques.length === 0 ? (
          <EmptyState title="لا توجد شيكات" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>رقم الشيك</TH>
                  <TH>البنك</TH>
                  <TH>تاريخ الاستحقاق</TH>
                  <TH>{direction === 'INCOMING' ? 'الساحب' : 'المستفيد'}</TH>
                  <TH>السند</TH>
                  <TH numeric>المبلغ</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {cheques.map((c) => {
                  const due = toDateOnly(c.dueDate)
                  return (
                    <TR key={c.id}>
                      <TD className="num font-medium">{c.number}</TD>
                      <TD>{c.bankName ?? '—'}</TD>
                      <TD>
                        {f.date(due)}
                        {c.status === 'IN_PORTFOLIO' && due <= today ? <Badge tone="red" className="ms-2">حلّ موعده</Badge> : null}
                      </TD>
                      <TD>{c.partyName ?? c.receipt?.payerName ?? c.voucher?.payeeName}</TD>
                      <TD>
                        {c.receipt ? (
                          <Link href={`/receipts/${c.receipt.id}`} className="num text-brand-700">
                            {c.receipt.number}
                          </Link>
                        ) : c.voucher ? (
                          <Link href={`/vouchers/${c.voucher.id}`} className="num text-brand-700">
                            {c.voucher.number}
                          </Link>
                        ) : null}
                      </TD>
                      <TD numeric className="font-semibold">
                        {f.money(c.amount)}
                      </TD>
                      <TD>
                        <StatusBadge map={CHEQUE_STATUS} value={c.status} />
                        {c.depositAccount ? <span className="ms-1 text-xs text-slate-500">{c.depositAccount.name}</span> : null}
                      </TD>
                      <TD>
                        {c.direction === 'INCOMING' && c.status === 'IN_PORTFOLIO' && can(user, 'cheques.manage') ? (
                          <ChequeActions chequeId={c.id} banks={banks.map((b) => ({ id: b.id, name: b.name }))} />
                        ) : null}
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD colSpan={5}>الإجمالي</TD>
                  <TD numeric>{f.money(sum(cheques.map((c) => D(c.amount))))}</TD>
                  <TD colSpan={2} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
        )}
      </div>
    </>
  )
}
