import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HardHat, Phone } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listVouchers } from '@/server/services/vouchers'
import { statementTarget } from '@/server/ledger/party-statements'
import { expenseCategories } from '@/server/ledger/accounts'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { DOC_STATUS, JOB_STATUS, PAYMENT_METHOD } from '@/lib/labels'
import { D, sum } from '@/lib/money'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/link-tabs'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatementView } from '@/components/ledger/statement-view'
import { ContractorDialog } from '@/components/parties/contractor-dialog'
import { JobDialog } from '@/components/parties/job-dialog'
import { JobActions } from '@/components/parties/job-actions'

export const metadata = { title: 'ملف عامل / مقاول' }

const TABS = [
  { key: 'jobs', label: 'الأعمال والاتفاقيات' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'statement', label: 'كشف الحساب' },
]

export default async function ContractorPage({ params, searchParams }: PageProps<'/contractors/[id]'>) {
  const user = await requirePermission('contractors.view')
  const { id } = await params
  const sp = await searchParams
  const contractor = await db.contractor.findUnique({ where: { id: Number(id) } })
  if (!contractor) notFound()
  const tab = TABS.find((t) => t.key === firstParam(sp.tab))?.key ?? 'jobs'
  const [fmt, jobs] = await Promise.all([
    getFormatConfig(),
    db.contractorJob.findMany({ where: { contractorId: contractor.id }, include: { expenseAccount: { select: { name: true } } }, orderBy: [{ startDate: 'desc' }, { id: 'desc' }] }),
  ])
  const f = makeFormatters(fmt)
  const agreed = sum(jobs.map((j) => j.agreedAmount))
  const paid = sum(jobs.map((j) => j.paidAmount))
  const manage = can(user, 'contractors.manage')
  const highlight = intParam(sp.job)

  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'العمال والمقاولون', href: '/contractors' }, { label: contractor.name }]} />
      <div className="card -mt-4 mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
              <HardHat className="size-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{contractor.name}</h1>
                {!contractor.isActive ? <Badge>غير فعال</Badge> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                {contractor.specialty ? <span>{contractor.specialty}</span> : null}
                {contractor.phone ? (
                  <a href={`tel:${contractor.phone}`} className="flex items-center gap-1 hover:text-brand-700">
                    <Phone className="size-3.5" />
                    <bdi className="ltr num">{contractor.phone}</bdi>
                  </a>
                ) : null}
                {contractor.nationalId ? <span>هوية: <span className="num">{contractor.nationalId}</span></span> : null}
              </div>
              {contractor.notes ? <p className="mt-1 text-sm text-slate-500">{contractor.notes}</p> : null}
            </div>
          </div>
          {manage ? (
            <ContractorDialog
              initial={{
                id: contractor.id,
                name: contractor.name,
                specialty: contractor.specialty ?? '',
                phone: contractor.phone ?? '',
                nationalId: contractor.nationalId ?? '',
                notes: contractor.notes ?? '',
                isActive: contractor.isActive,
              }}
            />
          ) : null}
        </div>
        <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/50">
          {[
            { label: 'إجمالي المتفق عليه', value: f.money(agreed), cls: '' },
            { label: 'إجمالي المدفوع', value: f.money(paid), cls: 'text-emerald-700' },
            { label: 'المتبقي له', value: f.money(agreed.minus(paid)), cls: agreed.minus(paid).greaterThan(0) ? 'text-rose-600' : 'text-slate-400' },
          ].map((x, i) => (
            <div key={i} className={cn('border-slate-100 px-5 py-3.5', i > 0 && 'border-s')}>
              <p className="text-xs text-slate-500">{x.label}</p>
              <p className={cn('mt-0.5 text-lg font-bold', x.cls)}>{x.value}</p>
            </div>
          ))}
        </div>
      </div>
      <LinkTabs className="mb-5" active={tab} tabs={TABS.map((t) => ({ ...t, href: `/contractors/${contractor.id}?tab=${t.key}` }))} />
      {tab === 'jobs' ? (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <p className="text-sm text-slate-500">كل عمل يُسجل المبلغ المتفق عليه مستحقًا، والدفعات تُصرف منه حتى السداد.</p>
            {manage ? <JobDialog contractorId={contractor.id} expenseAccounts={(await expenseCategories(db)).map((c) => ({ id: c.id, name: c.name }))} /> : null}
          </div>
          {jobs.length === 0 ? (
            <EmptyState title="لا توجد أعمال" description="سجّل العمل المتفق عليه ثم اصرف الدفعات عليه." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>العمل</TH>
                    <TH>نوع المصروف</TH>
                    <TH>البدء</TH>
                    <TH>الانتهاء</TH>
                    <TH numeric>المتفق عليه</TH>
                    <TH numeric>المدفوع</TH>
                    <TH numeric>المتبقي</TH>
                    <TH>الحالة</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {jobs.map((j) => {
                    const remaining = D(j.agreedAmount).minus(D(j.paidAmount))
                    return (
                      <TR key={j.id} className={cn(j.status === 'CANCELLED' && 'opacity-60', highlight === j.id && 'bg-amber-50')}>
                        <TD className="font-medium">
                          {j.description}
                          {j.notes ? <p className="text-xs font-normal text-slate-500">{j.notes}</p> : null}
                        </TD>
                        <TD className="text-slate-600">{j.expenseAccount.name}</TD>
                        <TD>{f.date(j.startDate)}</TD>
                        <TD>{j.endDate ? f.date(j.endDate) : '—'}</TD>
                        <TD numeric>{f.money(j.agreedAmount)}</TD>
                        <TD numeric>{f.money(j.paidAmount)}</TD>
                        <TD numeric className="font-semibold">
                          {f.money(remaining, { colored: true })}
                        </TD>
                        <TD>
                          <StatusBadge map={JOB_STATUS} value={j.status} />
                        </TD>
                        <TD>
                          <JobActions
                            job={{ id: j.id, description: j.description, agreed: j.agreedAmount.toString(), paid: j.paidAmount.toString(), remaining: remaining.toString(), status: j.status }}
                          />
                        </TD>
                      </TR>
                    )
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      ) : null}
      {tab === 'payments' ? <PaymentsTab contractorId={contractor.id} f={f} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'statement' ? (
        <StatementView
          target={(await statementTarget(db, 'contractor', contractor.id))!}
          from={isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null}
          to={isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null}
          hideReversed={firstParam(sp.hide) === '1'}
          f={f}
          canExport={can(user, 'reports.export')}
        />
      ) : null}
    </>
  )
}

type F = ReturnType<typeof makeFormatters>
type SP = Awaited<PageProps<'/contractors/[id]'>['searchParams']>

async function PaymentsTab({ contractorId, f, page, sp }: { contractorId: number; f: F; page?: number; sp: SP }) {
  const data = await listVouchers({ contractorId, page })
  return (
    <div className="card overflow-hidden">
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد دفعات" description="اصرف دفعة من قائمة الإجراءات بجانب العمل." />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>رقم السند</TH>
                <TH>التاريخ</TH>
                <TH>البيان</TH>
                <TH>الطريقة</TH>
                <TH numeric>المبلغ</TH>
                <TH>الحالة</TH>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((v) => (
                <TR key={v.id} className={v.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                  <TD>
                    <Link href={`/vouchers/${v.id}`} className="num font-semibold text-brand-700 hover:underline">
                      {v.number}
                    </Link>
                  </TD>
                  <TD>{f.date(v.date)}</TD>
                  <TD className="max-w-72 truncate text-slate-600">{v.description ?? v.contractorJob?.description ?? '—'}</TD>
                  <TD>{PAYMENT_METHOD[v.paymentMethod]}</TD>
                  <TD numeric className="font-semibold">
                    {f.money(v.amount)}
                  </TD>
                  <TD>
                    <StatusBadge map={DOC_STATUS} value={v.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={`/contractors/${contractorId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}
