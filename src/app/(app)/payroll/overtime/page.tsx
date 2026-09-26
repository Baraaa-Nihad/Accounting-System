import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listOvertime } from '@/server/services/payroll'
import { derivedRates } from '@/server/services/employees'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { OVERTIME_STATUS } from '@/lib/labels'
import { D, round } from '@/lib/money'
import { isDateOnly } from '@/lib/dates'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { PayrollTabs } from '@/components/payroll/payroll-tabs'
import { OvertimeDialog } from '@/components/payroll/overtime-dialog'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { cancelOvertimeAction } from '../actions'

export const metadata = { title: 'الساعات الإضافية' }

export default async function OvertimePage({ searchParams }: PageProps<'/payroll/overtime'>) {
  const user = await requirePermission('salaries.view', 'payroll.manage', 'overtime.manage')
  const sp = await searchParams
  const from = firstParam(sp.from)
  const to = firstParam(sp.to)
  const [fmt, settings, data, employees] = await Promise.all([
    getFormatConfig(),
    getSettings(),
    listOvertime(db, {
      employeeId: intParam(sp.employee),
      status: firstParam(sp.status),
      from: isDateOnly(from) ? from : undefined,
      to: isDateOnly(to) ? to : undefined,
      page: intParam(sp.page),
    }),
    db.employee.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
  ])
  const f = makeFormatters(fmt)
  const manage = can(user, 'overtime.manage')
  return (
    <>
      <PageHeader
        title="الرواتب"
        description="الساعات الإضافية تُسجل هنا أو من ملف الموظف، وتُصرف تلقائيًا مع مسير رواتب الشهر."
        actions={
          manage ? (
            <OvertimeDialog
              employees={employees.map((e) => ({
                id: e.id,
                fullName: e.fullName,
                defaultRate: round(e.overtimeRate ? D(e.overtimeRate) : derivedRates(e.salaryType, e.baseSalary, settings.payroll).hourly, fmt.decimals).toString(),
              }))}
            />
          ) : null
        }
      />
      <PayrollTabs active="overtime" />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <StatCard label="مجموع الساعات (حسب الفلتر)" value={f.number(data.totalHours, 2)} />
        <StatCard label="قيمة الإضافي (حسب الفلتر)" value={f.money(data.totalAmount)} accent="violet" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'select', name: 'employee', label: 'الموظف', options: employees.map((e) => ({ value: String(e.id), label: e.fullName })) },
            { type: 'select', name: 'status', label: 'الحالة', options: Object.entries(OVERTIME_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد ساعات إضافية" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>التاريخ</TH>
                  <TH>الموظف</TH>
                  <TH numeric>الساعات</TH>
                  <TH numeric>السعر</TH>
                  <TH numeric>القيمة</TH>
                  <TH>السبب</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((o) => (
                  <TR key={o.id} className={o.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                    <TD>{f.date(o.date)}</TD>
                    <TD>
                      <Link href={`/employees/${o.employee.id}`} className="font-medium hover:text-brand-700">
                        {o.employee.fullName}
                      </Link>
                    </TD>
                    <TD numeric>{f.number(o.hours.toString(), 2)}</TD>
                    <TD numeric>{f.money(o.rate)}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(o.amount)}
                    </TD>
                    <TD className="text-slate-600">{o.reason ?? '—'}</TD>
                    <TD>
                      <StatusBadge map={OVERTIME_STATUS} value={o.status} />
                      {o.payrollItem ? (
                        <Link href={`/payroll/${o.payrollItem.payrollRunId}`} className="num ms-2 text-xs text-brand-700">
                          {o.payrollItem.payrollRun.month}/{o.payrollItem.payrollRun.year}
                        </Link>
                      ) : null}
                    </TD>
                    <TD>
                      {manage && o.status !== 'CANCELLED' && o.payrollItem?.payrollRun.status !== 'APPROVED' ? (
                        <CancelDocButton id={o.id} action={cancelOvertimeAction} title="إلغاء الساعات الإضافية" description="تُلغى الساعات ولا تُصرف مع الراتب." label="إلغاء" iconOnly />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/payroll/overtime" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
