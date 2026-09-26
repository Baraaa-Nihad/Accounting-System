import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listPayrollRuns } from '@/server/services/payroll'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PAYROLL_STATUS } from '@/lib/labels'
import { ARABIC_MONTHS } from '@/lib/dates'
import { D } from '@/lib/money'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { NewRunDialog } from '@/components/payroll/new-run-dialog'
import { PayrollTabs } from '@/components/payroll/payroll-tabs'

export const metadata = { title: 'الرواتب' }

export default async function PayrollPage({ searchParams }: PageProps<'/payroll'>) {
  const user = await requirePermission('salaries.view', 'payroll.manage', 'payroll.pay')
  const sp = await searchParams
  const [fmt, data, active] = await Promise.all([
    getFormatConfig(),
    listPayrollRuns(db, { year: intParam(sp.year), status: firstParam(sp.status), page: intParam(sp.page) }),
    db.payrollRun.findMany({ where: { status: { not: 'CANCELLED' } }, select: { year: true, month: true } }),
  ])
  const f = makeFormatters(fmt)
  const years = [...new Set((await db.payrollRun.findMany({ select: { year: true }, distinct: ['year'] })).map((r) => r.year))].sort((a, b) => b - a)
  return (
    <>
      <PageHeader
        title="الرواتب"
        description="احتساب رواتب كل شهر، اعتمادها، ثم صرفها. كل مسير يمر بثلاث مراحل: مسودة ← معتمد ← مصروف."
        actions={can(user, 'payroll.manage') ? <NewRunDialog taken={active.map((r) => `${r.year}-${r.month}`)} /> : null}
      />
      <PayrollTabs active="runs" />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'select', name: 'year', label: 'السنة', options: years.map((y) => ({ value: String(y), label: String(y) })) },
            { type: 'select', name: 'status', label: 'الحالة', options: Object.entries(PAYROLL_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد مسيرات رواتب" description="اضغط «احتساب رواتب الشهر» لإنشاء أول مسير." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الشهر</TH>
                  <TH>الحالة</TH>
                  <TH numeric>الموظفون</TH>
                  <TH numeric>الإجمالي</TH>
                  <TH numeric>الخصومات</TH>
                  <TH numeric>الصافي</TH>
                  <TH numeric>المصروف</TH>
                  <TH numeric>المتبقي</TH>
                  <TH>أنشأه</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => {
                  const remaining = D(r.totalNet).minus(D(r.totalPaid))
                  return (
                    <TR key={r.id} className={r.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                      <TD>
                        <Link href={`/payroll/${r.id}`} className="font-semibold text-brand-700 hover:underline">
                          {ARABIC_MONTHS[r.month - 1]} <span className="num">{r.year}</span>
                        </Link>
                      </TD>
                      <TD>
                        <StatusBadge map={PAYROLL_STATUS} value={r.status} />
                      </TD>
                      <TD numeric>{f.number(r._count.items)}</TD>
                      <TD numeric>{f.money(r.totalGross)}</TD>
                      <TD numeric className="text-rose-600">
                        {f.money(r.totalDeductions, { hideZero: true })}
                      </TD>
                      <TD numeric className="font-semibold">
                        {f.money(r.totalNet)}
                      </TD>
                      <TD numeric>{f.money(r.totalPaid, { hideZero: true })}</TD>
                      <TD numeric className="font-semibold">
                        {r.status === 'APPROVED' ? f.money(remaining, { colored: true, hideZero: true }) : '—'}
                      </TD>
                      <TD className="text-slate-500">{r.createdBy?.fullName}</TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/payroll" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
