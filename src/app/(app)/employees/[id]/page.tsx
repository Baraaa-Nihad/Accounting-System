import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, Phone, UserRound, Printer } from 'lucide-react'
import { requirePermission, can, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { derivedRates, employeeSummary } from '@/server/services/employees'
import { listOvertime } from '@/server/services/payroll'
import { listAdvances } from '@/server/services/advances'
import { listVouchers } from '@/server/services/vouchers'
import { cashAccountsSummary } from '@/server/services/treasury'
import { statementTarget } from '@/server/ledger/party-statements'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters, type Formatters } from '@/lib/format-jsx'
import { ADVANCE_STATUS, DOC_STATUS, EMPLOYEE_STATUS, GENDER, OVERTIME_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, PAYROLL_STATUS, SALARY_TYPE, VOUCHER_KIND } from '@/lib/labels'
import { D, round } from '@/lib/money'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/link-tabs'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatementView } from '@/components/ledger/statement-view'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { AuditTrail } from '@/components/audit/audit-trail'
import { EmployeeStatusButton } from '@/components/employees/employee-status-button'
import { OvertimeDialog } from '@/components/payroll/overtime-dialog'
import { AdvanceDialog } from '@/components/payroll/advance-dialog'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { cancelOvertimeAction } from '../../payroll/actions'

export const metadata = { title: 'ملف الموظف' }

export default async function EmployeePage({ params, searchParams }: PageProps<'/employees/[id]'>) {
  const user = await requirePermission('employees.view')
  const { id } = await params
  const sp = await searchParams
  const emp = await db.employee.findUnique({ where: { id: Number(id) } })
  if (!emp) notFound()
  const salaries = canSeeSalaries(user)
  const tabs = [
    { key: 'overview', label: 'البيانات' },
    ...(salaries
      ? [
          { key: 'payroll', label: 'الرواتب' },
          { key: 'overtime', label: 'الإضافي' },
          { key: 'advances', label: 'السلف' },
          { key: 'payments', label: 'الدفعات' },
          { key: 'statement', label: 'كشف الحساب' },
        ]
      : []),
  ]
  const tab = tabs.find((t) => t.key === firstParam(sp.tab))?.key ?? 'overview'
  const [fmt, settings] = await Promise.all([getFormatConfig(), getSettings()])
  const f = makeFormatters(fmt)
  const summary = salaries ? await employeeSummary(db, emp.id) : null
  const hourly = emp.overtimeRate ? D(emp.overtimeRate) : derivedRates(emp.salaryType, emp.baseSalary, settings.payroll).hourly
  const cash = salaries && can(user, 'advances.manage') ? (await cashAccountsSummary(db)).filter((c) => c.isActive) : []
  const active = emp.status === 'ACTIVE'

  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'الموظفون والمعلمات', href: '/employees' }, { label: emp.fullName }]} />
      <div className="card -mt-4 mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
              <UserRound className="size-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{emp.fullName}</h1>
                <StatusBadge map={EMPLOYEE_STATUS} value={emp.status} />
                {emp.isTeacher ? <Badge tone="violet">معلم</Badge> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                <span>
                  الرقم الوظيفي: <b className="num text-slate-700">{emp.employeeNumber}</b>
                </span>
                {emp.jobTitle ? <span>{emp.jobTitle}</span> : null}
                {emp.department ? <span>{emp.department}</span> : null}
                {emp.phone ? (
                  <a href={`tel:${emp.phone}`} className="flex items-center gap-1 hover:text-brand-700">
                    <Phone className="size-3.5" />
                    <bdi className="ltr num">{emp.phone}</bdi>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && can(user, 'overtime.manage') && salaries ? (
              <OvertimeDialog employees={[{ id: emp.id, fullName: emp.fullName, defaultRate: round(hourly, fmt.decimals).toString() }]} fixedEmployeeId={emp.id} />
            ) : null}
            {active && can(user, 'advances.manage') && can(user, 'vouchers.create') && salaries ? (
              <AdvanceDialog
                employees={[{ id: emp.id, fullName: emp.fullName }]}
                fixedEmployeeId={emp.id}
                cashAccounts={cash.map((c) => ({ id: c.id, name: c.name, type: c.type, balance: c.balance, isDefault: c.isDefault }))}
              />
            ) : null}
            {can(user, 'employees.manage') ? (
              <>
                <Button variant="ghost" asChild>
                  <Link href={`/employees/${emp.id}/edit`}>
                    <Pencil />
                    تعديل
                  </Link>
                </Button>
                <EmployeeStatusButton employeeId={emp.id} active={active} />
              </>
            ) : null}
          </div>
        </div>
        {summary ? (
          <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/50 sm:grid-cols-4">
            {[
              { label: `الراتب (${SALARY_TYPE[emp.salaryType]})`, value: f.money(emp.baseSalary), cls: '' },
              { label: 'رواتب مستحقة غير مصروفة', value: f.money(summary.salaryDue), cls: D(summary.salaryDue).greaterThan(0) ? 'text-rose-600' : 'text-slate-400' },
              { label: 'سلف قائمة عليه', value: f.money(summary.advancesOutstanding), cls: D(summary.advancesOutstanding).greaterThan(0) ? 'text-amber-700' : 'text-slate-400' },
              { label: 'إجمالي الرواتب المصروفة', value: f.money(summary.salariesPaid), cls: 'text-emerald-700' },
            ].map((x, i) => (
              <div key={i} className={cn('border-slate-100 px-5 py-3.5', i > 0 && 'sm:border-s')}>
                <p className="text-xs text-slate-500">{x.label}</p>
                <p className={cn('mt-0.5 text-lg font-bold', x.cls)}>{x.value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {tabs.length > 1 ? <LinkTabs className="mb-5" active={tab} tabs={tabs.map((t) => ({ ...t, href: `/employees/${emp.id}?tab=${t.key}` }))} /> : null}

      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="البيانات الشخصية والوظيفية" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['الجنس', emp.gender ? GENDER[emp.gender] : '—'],
                  ['رقم الهوية', emp.nationalId ?? '—'],
                  ['تاريخ التعيين', emp.hireDate ? f.date(emp.hireDate) : '—'],
                  ['العنوان', emp.address ?? '—'],
                  ['البنك', emp.bankName ?? '—'],
                  ['رقم الحساب', emp.bankAccount ?? '—'],
                  ['IBAN', emp.iban ?? '—'],
                  ...(salaries ? [['سعر ساعة الإضافي', emp.overtimeRate ? f.money(emp.overtimeRate) : <span key="r">{f.money(round(hourly, fmt.decimals))} <span className="text-xs text-slate-400">(محسوب من الراتب)</span></span>]] : []),
                  ...(emp.endDate ? [['تاريخ انتهاء الخدمة', f.date(emp.endDate)]] : []),
                ].map(([label, value], i) => (
                  <div key={i}>
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
                {emp.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-slate-500">ملاحظات</dt>
                    <dd className="whitespace-pre-line">{emp.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </CardBody>
          </Card>
          <AttachmentsPanel entityType="Employee" entityId={emp.id} canUpload={can(user, 'employees.manage')} />
          {can(user, 'audit.view') ? (
            <div className="lg:col-span-3">
              <AuditTrail entityType="Employee" entityId={emp.id} />
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'payroll' ? <PayrollTab employeeId={emp.id} f={f} /> : null}
      {tab === 'overtime' ? <OvertimeTab employeeId={emp.id} f={f} canManage={can(user, 'overtime.manage')} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'advances' ? <AdvancesTab employeeId={emp.id} f={f} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'payments' ? <PaymentsTab employeeId={emp.id} f={f} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'statement' ? (
        <StatementView
          target={(await statementTarget(db, 'employee', emp.id))!}
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

type SP = Awaited<PageProps<'/employees/[id]'>['searchParams']>

async function PayrollTab({ employeeId, f }: { employeeId: number; f: Formatters }) {
  const items = await db.payrollItem.findMany({
    where: { employeeId },
    include: { payrollRun: true },
    orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
    take: 60,
  })
  return (
    <div className="card overflow-hidden">
      {items.length === 0 ? (
        <EmptyState title="لا توجد رواتب محتسبة" description="تظهر هنا رواتب الموظف من مسيرات الرواتب الشهرية." />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الشهر</TH>
                <TH>حالة المسير</TH>
                <TH numeric>الأساسي</TH>
                <TH numeric>الإضافي</TH>
                <TH numeric>الإجمالي</TH>
                <TH numeric>الخصومات</TH>
                <TH numeric>الصافي</TH>
                <TH numeric>المصروف</TH>
                <TH>الصرف</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {items.map((it) => (
                <TR key={it.id} className={it.payrollRun.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                  <TD>
                    <Link href={`/payroll/${it.payrollRunId}`} className="num font-semibold text-brand-700 hover:underline">
                      {it.payrollRun.month}/{it.payrollRun.year}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge map={PAYROLL_STATUS} value={it.payrollRun.status} />
                  </TD>
                  <TD numeric>{f.money(it.basicPay)}</TD>
                  <TD numeric>{f.money(it.overtimeAmount, { hideZero: true })}</TD>
                  <TD numeric>{f.money(it.grossPay)}</TD>
                  <TD numeric className="text-rose-600">
                    {f.money(it.totalDeductions, { hideZero: true })}
                  </TD>
                  <TD numeric className="font-semibold">
                    {f.money(it.netPay)}
                  </TD>
                  <TD numeric>{f.money(it.paidAmount, { hideZero: true })}</TD>
                  <TD>{it.payrollRun.status === 'APPROVED' ? <StatusBadge map={PAYMENT_STATUS} value={it.paymentStatus} /> : '—'}</TD>
                  <TD>
                    {it.payrollRun.status === 'APPROVED' ? (
                      <Link href={`/print/payslips/${it.id}`} target="_blank" className="text-slate-400 hover:text-brand-700" title="قسيمة الراتب">
                        <Printer className="size-4" />
                      </Link>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  )
}

async function OvertimeTab({ employeeId, f, canManage, page, sp }: { employeeId: number; f: Formatters; canManage: boolean; page?: number; sp: SP }) {
  const data = await listOvertime(db, { employeeId, page })
  return (
    <div className="card overflow-hidden">
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد ساعات إضافية" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>التاريخ</TH>
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
                    {canManage && o.status !== 'CANCELLED' && o.payrollItem?.payrollRun.status !== 'APPROVED' ? (
                      <CancelDocButton id={o.id} action={cancelOvertimeAction} title="إلغاء الساعات الإضافية" description="تُلغى الساعات ولا تُصرف مع الراتب." label="إلغاء" iconOnly />
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={`/employees/${employeeId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}

async function AdvancesTab({ employeeId, f, page, sp }: { employeeId: number; f: Formatters; page?: number; sp: SP }) {
  const data = await listAdvances(db, { employeeId, page })
  return (
    <div className="card overflow-hidden">
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد سلف" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>التاريخ</TH>
                <TH numeric>المبلغ</TH>
                <TH numeric>القسط الشهري</TH>
                <TH>يبدأ من</TH>
                <TH numeric>المخصوم</TH>
                <TH numeric>المتبقي</TH>
                <TH>السند</TH>
                <TH>الحالة</TH>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((a) => (
                <TR key={a.id} className={a.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                  <TD>{f.date(a.date)}</TD>
                  <TD numeric className="font-semibold">
                    {f.money(a.amount)}
                  </TD>
                  <TD numeric>{f.money(a.monthlyDeduction)}</TD>
                  <TD className="num">
                    {a.startMonth}/{a.startYear}
                  </TD>
                  <TD numeric>{f.money(a.deductedAmount)}</TD>
                  <TD numeric className="font-semibold">
                    {f.money(D(a.amount).minus(D(a.deductedAmount)), { colored: true })}
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
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={`/employees/${employeeId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}

async function PaymentsTab({ employeeId, f, page, sp }: { employeeId: number; f: Formatters; page?: number; sp: SP }) {
  const data = await listVouchers({ employeeId, page })
  return (
    <div className="card overflow-hidden">
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد دفعات" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>رقم السند</TH>
                <TH>التاريخ</TH>
                <TH>النوع</TH>
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
                  <TD>{VOUCHER_KIND[v.kind]}</TD>
                  <TD className="max-w-72 truncate text-slate-600">{v.description ?? '—'}</TD>
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
      <Pagination path={`/employees/${employeeId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}
