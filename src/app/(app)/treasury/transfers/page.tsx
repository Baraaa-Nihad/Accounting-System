import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { cashAccountsSummary, listTransfers } from '@/server/services/treasury'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { DOC_STATUS } from '@/lib/labels'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { TransferDialog } from '@/components/treasury/transfer-dialog'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { cancelTransferAction } from '../actions'

export const metadata = { title: 'التحويلات بين الصناديق' }

export default async function TransfersPage({ searchParams }: PageProps<'/treasury/transfers'>) {
  const user = await requirePermission('treasury.view')
  const sp = await searchParams
  const from = firstParam(sp.from)
  const to = firstParam(sp.to)
  const highlight = intParam(sp.highlight)
  const [fmt, accounts, data] = await Promise.all([
    getFormatConfig(),
    cashAccountsSummary(db),
    listTransfers(db, {
      from: isDateOnly(from) ? from : undefined,
      to: isDateOnly(to) ? to : undefined,
      accountId: intParam(sp.account),
      status: firstParam(sp.status),
      page: intParam(sp.page),
    }),
  ])
  const f = makeFormatters(fmt)
  const active = accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))
  return (
    <>
      <PageHeader
        title="التحويلات بين الصناديق والبنوك"
        breadcrumbs={[{ label: 'الصندوق والبنوك', href: '/treasury' }, { label: 'التحويلات' }]}
        actions={can(user, 'treasury.transfer') && active.length > 1 ? <TransferDialog accounts={active} /> : null}
      />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
            { type: 'select', name: 'account', label: 'الحساب', options: accounts.map((a) => ({ value: String(a.id), label: a.name })) },
            { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'CANCELLED', label: 'ملغي' }] },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد تحويلات" description="استخدم زر «تحويل مبلغ» لنقل مبلغ بين صندوق وبنك." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الرقم</TH>
                  <TH>التاريخ</TH>
                  <TH>من</TH>
                  <TH>إلى</TH>
                  <TH numeric>المبلغ</TH>
                  <TH>البيان</TH>
                  <TH>بواسطة</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((t) => (
                  <TR key={t.id} className={cn(t.status === 'CANCELLED' && 'opacity-60', highlight === t.id && 'bg-amber-50')}>
                    <TD className="num font-semibold">{t.number}</TD>
                    <TD>{f.date(t.date)}</TD>
                    <TD>{t.fromAccount.name}</TD>
                    <TD>{t.toAccount.name}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(t.amount)}
                    </TD>
                    <TD className="text-slate-600">
                      {t.description ?? '—'}
                      {t.status === 'CANCELLED' ? <p className="text-xs text-rose-600">أُلغي: {t.cancelReason}</p> : null}
                    </TD>
                    <TD className="text-slate-500">{t.createdBy?.fullName}</TD>
                    <TD>
                      <StatusBadge map={DOC_STATUS} value={t.status} />
                    </TD>
                    <TD>
                      {t.status === 'ACTIVE' && can(user, 'treasury.manage') ? (
                        <CancelDocButton
                          id={t.id}
                          action={cancelTransferAction}
                          title={`إلغاء التحويل ${t.number}`}
                          description="يُعكس التحويل بقيد إلغاء ويعود المبلغ إلى الحساب المحوَّل منه. يبقى التحويل ظاهرًا بحالة «ملغي»."
                          label="إلغاء التحويل"
                          iconOnly
                        />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/treasury/transfers" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
