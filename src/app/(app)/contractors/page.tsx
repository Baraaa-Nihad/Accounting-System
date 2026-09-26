import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listContractors } from '@/server/services/parties'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { D } from '@/lib/money'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { ContractorDialog } from '@/components/parties/contractor-dialog'

export const metadata = { title: 'العمال والمقاولون' }

export default async function ContractorsPage({ searchParams }: PageProps<'/contractors'>) {
  const user = await requirePermission('contractors.view')
  const sp = await searchParams
  const [fmt, data, totals] = await Promise.all([
    getFormatConfig(),
    listContractors(db, { q: firstParam(sp.q), page: intParam(sp.page) }),
    db.contractorJob.aggregate({ _sum: { agreedAmount: true, paidAmount: true } }),
  ])
  const f = makeFormatters(fmt)
  const remaining = D(totals._sum.agreedAmount).minus(D(totals._sum.paidAmount))
  return (
    <>
      <PageHeader
        title="العمال والمقاولون"
        description="العمال اليوميون والمقاولون والفنيون: الأعمال المتفق عليها، الدفعات، والمتبقي لكل منهم."
        actions={can(user, 'contractors.manage') ? <ContractorDialog /> : null}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="إجمالي قيمة الأعمال" value={f.money(D(totals._sum.agreedAmount))} />
        <StatCard label="إجمالي المدفوع" value={f.money(D(totals._sum.paidAmount))} accent="green" />
        <StatCard label="المتبقي لهم" value={f.money(remaining)} accent="red" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar fields={[{ type: 'search', name: 'q', placeholder: 'الاسم، التخصص، الهاتف...' }]} />
        {data.rows.length === 0 ? (
          <EmptyState title="لا يوجد عمال أو مقاولون" description="أضف عاملًا أو مقاولًا ثم سجّل الأعمال المتفق عليها معه." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الاسم</TH>
                  <TH>التخصص</TH>
                  <TH>الهاتف</TH>
                  <TH numeric>الأعمال</TH>
                  <TH numeric>المتفق عليه</TH>
                  <TH numeric>المدفوع</TH>
                  <TH numeric>المتبقي</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <TR key={r.id} className={!r.isActive ? 'opacity-60' : undefined}>
                    <TD>
                      <Link href={`/contractors/${r.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {r.name}
                      </Link>
                      {!r.isActive ? <Badge className="ms-2">غير فعال</Badge> : null}
                    </TD>
                    <TD className="text-slate-600">{r.specialty ?? '—'}</TD>
                    <TD>{r.phone ? <bdi className="ltr num">{r.phone}</bdi> : '—'}</TD>
                    <TD numeric>{f.number(Number(r.jobs))}</TD>
                    <TD numeric>{f.money(r.agreed)}</TD>
                    <TD numeric>{f.money(r.paid)}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(D(r.agreed).minus(D(r.paid)), { colored: true })}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/contractors" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
