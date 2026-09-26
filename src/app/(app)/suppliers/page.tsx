import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listSuppliers } from '@/server/services/parties'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { SupplierDialog } from '@/components/parties/supplier-dialog'

export const metadata = { title: 'الموردون' }

export default async function SuppliersPage({ searchParams }: PageProps<'/suppliers'>) {
  const user = await requirePermission('suppliers.view')
  const sp = await searchParams
  const status = firstParam(sp.status)
  const [fmt, data, all] = await Promise.all([
    getFormatConfig(),
    listSuppliers(db, { q: firstParam(sp.q), active: status === 'active' ? true : status === 'inactive' ? false : undefined, page: intParam(sp.page) }),
    listSuppliers(db, { pageSize: 1000 }),
  ])
  const f = makeFormatters(fmt)
  const totalDue = sum(all.rows.map((r) => (D(r.balance).greaterThan(0) ? r.balance : '0')))
  return (
    <>
      <PageHeader
        title="الموردون"
        description="الموردون وفواتيرهم ودفعاتهم. الرصيد = المستحق للمورد (الفواتير − الدفعات)."
        actions={can(user, 'suppliers.manage') ? <SupplierDialog /> : null}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <StatCard label="عدد الموردين" value={f.number(all.total)} />
        <StatCard label="إجمالي المستحق للموردين" value={f.money(totalDue)} accent="red" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'اسم المورد، التصنيف، الهاتف...' },
            { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غير فعال' }] },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا يوجد موردون" description="أضف موردًا لتسجيل فواتيره ودفعاته." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>المورد</TH>
                  <TH>التصنيف</TH>
                  <TH>الهاتف</TH>
                  <TH numeric>الفواتير</TH>
                  <TH numeric>المدفوع</TH>
                  <TH numeric>المستحق</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <TR key={r.id} className={!r.isActive ? 'opacity-60' : undefined}>
                    <TD>
                      <Link href={`/suppliers/${r.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {r.name}
                      </Link>
                      {!r.isActive ? <Badge className="ms-2">غير فعال</Badge> : null}
                    </TD>
                    <TD className="text-slate-600">{r.category ?? '—'}</TD>
                    <TD>{r.phone ? <bdi className="ltr num">{r.phone}</bdi> : '—'}</TD>
                    <TD numeric>{f.money(r.bills)}</TD>
                    <TD numeric>{f.money(r.paid)}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(r.balance, { colored: true })}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/suppliers" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
