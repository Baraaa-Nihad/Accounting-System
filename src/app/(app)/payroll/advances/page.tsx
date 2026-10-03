import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listAdvances } from '@/server/services/advances'
import { boxOptionsFor } from '@/server/services/treasury'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { ADVANCE_STATUS } from '@/lib/labels'
import { D } from '@/lib/money'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { PayrollTabs } from '@/components/payroll/payroll-tabs'
import { AdvanceDialog } from '@/components/payroll/advance-dialog'
import { AdvanceScheduleDialog } from '@/components/payroll/advance-schedule-dialog'

export const metadata = { title: 'سلف الموظفين' }

export default async function AdvancesPage({ searchParams }: PageProps<'/payroll/advances'>) {
  const user = await requirePermission('salaries.view', 'payroll.manage', 'advances.manage')
  const sp = await searchParams
  const manage = can(user, 'advances.manage')
  const [fmt, data, employees, cash] = await Promise.all([
    getFormatConfig(),
    listAdvances(db, { employeeId: intParam(sp.employee), status: firstParam(sp.status) ?? 'ACTIVE', page: intParam(sp.page) }),
    db.employee.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
    manage ? boxOptionsFor(db, user.id, user.permissions) : Promise.resolve([]),
  ])
  const f = makeFormatters(fmt)
  return (
    <>
      <PageHeader
        title="الرواتب"
        description="السلف تُصرف بسند صرف، وتُخصم أقساطها تلقائيًا من الرواتب حتى تُسدد."
        actions={
          manage && can(user, 'vouchers.create') ? (
            <AdvanceDialog
              employees={employees}
              cashAccounts={cash}
            />
          ) : null
        }
      />
      <PayrollTabs active="advances" />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="مجموع السلف (حسب الفلتر)" value={f.money(data.totalAmount)} />
        <StatCard label="المخصوم من الرواتب" value={f.money(data.totalDeducted)} accent="green" />
        <StatCard label="المتبقي على الموظفين" value={f.money(D(data.totalAmount).minus(D(data.totalDeducted)))} accent="amber" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'select', name: 'employee', label: 'الموظف', options: employees.map((e) => ({ value: String(e.id), label: e.fullName })) },
            { type: 'select', name: 'status', label: 'الحالة', allLabel: 'قيد السداد', options: [{ value: 'SETTLED', label: 'مسددة' }, { value: 'CANCELLED', label: 'ملغاة' }, { value: 'ALL', label: 'الكل' }] },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد سلف" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>التاريخ</TH>
                  <TH>الموظف</TH>
                  <TH numeric>المبلغ</TH>
                  <TH numeric>القسط الشهري</TH>
                  <TH>يبدأ من</TH>
                  <TH numeric>المخصوم</TH>
                  <TH numeric>المتبقي</TH>
                  <TH>السند</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((a) => {
                  const remaining = D(a.amount).minus(D(a.deductedAmount))
                  return (
                    <TR key={a.id} className={a.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                      <TD>{f.date(a.date)}</TD>
                      <TD>
                        <Link href={`/employees/${a.employee.id}?tab=advances`} className="font-medium hover:text-brand-700">
                          {a.employee.fullName}
                        </Link>
                        {a.reason ? <p className="text-xs text-slate-500">{a.reason}</p> : null}
                      </TD>
                      <TD numeric className="font-semibold">
                        {f.money(a.amount)}
                      </TD>
                      <TD numeric>{f.money(a.monthlyDeduction)}</TD>
                      <TD className="num">
                        {a.startMonth}/{a.startYear}
                      </TD>
                      <TD numeric>{f.money(a.deductedAmount)}</TD>
                      <TD numeric className="font-semibold">
                        {f.money(remaining, { colored: true })}
                      </TD>
                      <TD>
                        {a.voucher ? (
                          <Link href={`/vouchers/${a.voucher.id}`} className="num text-xs text-brand-700">
                            {a.voucher.number}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>
                        <StatusBadge map={ADVANCE_STATUS} value={a.status} />
                      </TD>
                      <TD>
                        {manage && a.status === 'ACTIVE' ? (
                          <AdvanceScheduleDialog
                            advance={{
                              id: a.id,
                              employeeName: a.employee.fullName,
                              monthlyDeduction: a.monthlyDeduction.toString(),
                              startYear: a.startYear,
                              startMonth: a.startMonth,
                              remaining: remaining.toString(),
                            }}
                          />
                        ) : null}
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/payroll/advances" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
