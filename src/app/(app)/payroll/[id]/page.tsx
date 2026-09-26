import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getPayrollRun, plannedAdvancesForRun, runLabel } from '@/server/services/payroll'
import { cashAccountsSummary } from '@/server/services/treasury'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PAYROLL_STATUS } from '@/lib/labels'
import { ARABIC_MONTHS } from '@/lib/dates'
import { D } from '@/lib/money'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { AuditTrail } from '@/components/audit/audit-trail'
import { PayrollGrid } from '@/components/payroll/payroll-grid'
import { RunActions } from '@/components/payroll/run-actions'

export const metadata = { title: 'مسير الرواتب' }

export default async function PayrollRunPage({ params }: PageProps<'/payroll/[id]'>) {
  const user = await requirePermission('salaries.view', 'payroll.manage', 'payroll.pay')
  const { id } = await params
  const run = await getPayrollRun(db, Number(id))
  if (!run) notFound()
  const [fmt, settings, planned, cash, missing] = await Promise.all([
    getFormatConfig(),
    getSettings(),
    plannedAdvancesForRun(db, run, run.items.map((i) => i.employeeId)),
    run.status === 'APPROVED' ? cashAccountsSummary(db) : Promise.resolve([]),
    run.status === 'DRAFT'
      ? db.employee.findMany({ where: { status: 'ACTIVE', id: { notIn: run.items.map((i) => i.employeeId) } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
      : Promise.resolve([]),
  ])
  const f = makeFormatters(fmt)
  const label = runLabel(run)
  const remaining = D(run.totalNet).minus(D(run.totalPaid))
  const editable = run.status === 'DRAFT' && can(user, 'payroll.manage')
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            مسير رواتب {ARABIC_MONTHS[run.month - 1]} <span className="num">{run.year}</span>
            <StatusBadge map={PAYROLL_STATUS} value={run.status} />
          </span>
        }
        description={
          run.status === 'DRAFT'
            ? 'مسودة: أدخل الغياب والتأخير والمكافآت والخصومات لكل موظف (يُحفظ كل صف تلقائيًا عند الانتقال منه)، ثم اعتمد المسير.'
            : run.status === 'APPROVED'
              ? `معتمد بتاريخ قيد ${f.dateText(run.postingDate)}. اصرف الرواتب لكل الموظفين أو لكل موظف على حدة.`
              : `ملغي — ${run.cancelReason ?? ''}`
        }
        breadcrumbs={[{ label: 'الرواتب', href: '/payroll' }, { label }]}
        actions={
          <RunActions
            run={{ id: run.id, status: run.status, label, totalNet: run.totalNet.toString(), totalPaid: run.totalPaid.toString() }}
            cashAccounts={cash.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, type: c.type, balance: c.balance, isDefault: c.isDefault }))}
            missingEmployees={missing}
          />
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="عدد الموظفين" value={f.number(run.items.length)} />
        <StatCard label="إجمالي الرواتب" value={f.money(run.totalGross)} />
        <StatCard label="إجمالي الخصومات" value={f.money(run.totalDeductions)} accent="red" />
        <StatCard label="صافي الرواتب" value={f.money(run.totalNet)} accent="brand" emphasis />
        <StatCard
          label={run.status === 'APPROVED' ? 'المتبقي للصرف' : 'المصروف'}
          value={f.money(run.status === 'APPROVED' ? remaining : run.totalPaid)}
          accent={remaining.greaterThan(0) && run.status === 'APPROVED' ? 'amber' : 'green'}
          hint={run.status === 'APPROVED' ? <>المصروف: {f.money(run.totalPaid)}</> : undefined}
        />
      </div>
      {run.status === 'APPROVED' && run.journalEntryId && can(user, 'accounting.view') ? (
        <p className="mb-3 text-sm text-slate-500">
          <Link href={`/accounting/journal/${run.journalEntryId}`} className="text-brand-700 hover:underline">
            عرض قيد الرواتب
          </Link>
        </p>
      ) : null}
      <div className="card overflow-hidden">
        <PayrollGrid
          runId={run.id}
          editable={editable}
          cfg={{ workDaysPerMonth: settings.payroll.workDaysPerMonth, hoursPerDay: settings.payroll.hoursPerDay, decimals: settings.finance.decimals }}
          items={run.items.map((i) => ({
            id: i.id,
            employeeId: i.employeeId,
            employeeName: i.employee.fullName,
            employeeNumber: i.employee.employeeNumber,
            jobTitle: i.employee.jobTitle,
            isTeacher: i.employee.isTeacher,
            salaryType: i.salaryType,
            rate: i.rate.toString(),
            workDays: i.workDays.toString(),
            workHours: i.workHours.toString(),
            absenceDays: i.absenceDays.toString(),
            lateHours: i.lateHours.toString(),
            overtimeHours: i.overtimeHours.toString(),
            overtimeAmount: i.overtimeAmount.toString(),
            bonuses: i.bonuses.toString(),
            allowances: i.allowances.toString(),
            otherDeductions: i.otherDeductions.toString(),
            withholdings: i.withholdings.toString(),
            plannedAdvance: run.status === 'DRAFT' ? (planned.get(i.employeeId) ?? '0') : i.advanceDeduction.toString(),
            advanceDeduction: i.advanceDeduction.toString(),
            basicPay: i.basicPay.toString(),
            grossPay: i.grossPay.toString(),
            totalDeductions: i.totalDeductions.toString(),
            netPay: i.netPay.toString(),
            paidAmount: i.paidAmount.toString(),
            paymentStatus: i.paymentStatus,
          }))}
        />
      </div>
      {can(user, 'audit.view') ? (
        <div className="mt-5">
          <AuditTrail entityType="PayrollRun" entityId={run.id} />
        </div>
      ) : null}
    </>
  )
}
