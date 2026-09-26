import 'server-only'
import { db } from '../db'
import { getSettings } from '../settings'
import type { CurrentUser } from '../auth/guard'
import { addDays, daysInMonth, diffDays, fromDateOnly, makeDate, parts, todayInTimeZone, toDateOnly } from '@/lib/dates'
import { accountsTotals } from '../ledger/balances'
import { D } from '@/lib/money'
import { formatAmount } from '@/lib/format'
import { latestSuccessfulBackupDate } from '../backup/catalog'

/**
 * مركز التنبيهات: كل التنبيهات تُحسب لحظيًا من البيانات (لا تُخزن)، لذلك هي دقيقة دائمًا.
 */

export interface Alert {
  id: string
  level: 'info' | 'warning' | 'danger'
  title: string
  description?: string
  href: string
}

export async function getAlerts(user: CurrentUser): Promise<Alert[]> {
  const settings = await getSettings()
  const today = todayInTimeZone(settings.finance.timezone)
  const todayDate = fromDateOnly(today)
  const tomorrowDate = fromDateOnly(addDays(today, 1))
  const overdueBefore = fromDateOnly(addDays(today, -settings.finance.graceDays))
  const alerts: Alert[] = []
  const can = (p: Parameters<CurrentUser['permissions']['has']>[0]) => user.permissions.has(p)

  if (can('charges.view')) {
    const [dueToday] = await db.$queryRaw<{ students: bigint; amount: string }[]>`
      SELECT COUNT(DISTINCT i."studentId") AS students, COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."dueDate" = ${todayDate} AND i."status" IN ('UNPAID', 'PARTIAL') AND c."status" = 'ACTIVE'`
    if (Number(dueToday.students) > 0) {
      alerts.push({
        id: 'due-today',
        level: 'warning',
        title: `يوجد ${Number(dueToday.students)} طالبًا لديهم قسط مستحق اليوم`,
        description: `إجمالي المستحق اليوم: ${formatAmount(dueToday.amount, settings.finance.decimals)} ${settings.finance.currencySymbol}`,
        href: '/charges?tab=due&period=today',
      })
    }
    const [overdue] = await db.$queryRaw<{ students: bigint; amount: string }[]>`
      SELECT COUNT(DISTINCT i."studentId") AS students, COALESCE(SUM(i."amount" - i."paidAmount"), 0)::text AS amount
      FROM "installments" i JOIN "charges" c ON c."id" = i."chargeId"
      WHERE i."dueDate" < ${overdueBefore} AND i."status" IN ('UNPAID', 'PARTIAL') AND c."status" = 'ACTIVE'`
    if (Number(overdue.students) > 0) {
      alerts.push({
        id: 'overdue',
        level: 'danger',
        title: `يوجد ${Number(overdue.students)} طالبًا متأخرين عن الدفع`,
        description: `إجمالي المتأخرات: ${formatAmount(overdue.amount, settings.finance.decimals)} ${settings.finance.currencySymbol}`,
        href: '/charges?tab=overdue',
      })
    }
  }

  if (can('payroll.manage') || can('salaries.view')) {
    const { y, m } = parts(today)
    const payDate = makeDate(y, m, Math.min(settings.payroll.payDay, daysInMonth(y, m)))
    const daysLeft = diffDays(payDate, today)
    if (daysLeft >= 0 && daysLeft <= settings.payroll.alertDaysBefore) {
      const activeEmployees = await db.employee.count({ where: { status: 'ACTIVE' } })
      const run = await db.payrollRun.findFirst({ where: { year: y, month: m, status: { not: 'CANCELLED' } } })
      const fullyPaid = run && run.status === 'APPROVED' && D(run.totalPaid).greaterThanOrEqualTo(D(run.totalNet))
      if (activeEmployees > 0 && !fullyPaid) {
        alerts.push({
          id: 'payroll-due',
          level: 'warning',
          title: daysLeft === 0 ? 'رواتب الموظفين تستحق اليوم' : `رواتب الموظفين تستحق خلال ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'}`,
          description: run ? (run.status === 'DRAFT' ? 'مسير الشهر ما زال مسودة' : 'المسير معتمد ولم يُصرف بالكامل') : 'لم يتم احتساب رواتب هذا الشهر بعد',
          href: '/payroll',
        })
      }
    }
  }

  if (can('receipts.view') || can('cheques.manage')) {
    const dueTomorrow = await db.cheque.count({
      where: { direction: 'INCOMING', status: 'IN_PORTFOLIO', dueDate: tomorrowDate },
    })
    if (dueTomorrow > 0) {
      alerts.push({
        id: 'cheques-tomorrow',
        level: 'info',
        title: `يوجد ${dueTomorrow} ${dueTomorrow === 1 ? 'شيك مستحق' : 'شيكات مستحقة'} غدًا`,
        description: 'شيكات واردة في الحافظة يجب إيداعها أو تحصيلها',
        href: '/cheques',
      })
    }
    const pastDue = await db.cheque.count({
      where: { direction: 'INCOMING', status: 'IN_PORTFOLIO', dueDate: { lte: todayDate } },
    })
    if (pastDue > 0) {
      alerts.push({
        id: 'cheques-due',
        level: 'warning',
        title: `يوجد ${pastDue} ${pastDue === 1 ? 'شيك حلّ موعده' : 'شيكات حلّ موعدها'} ولم يُحصّل بعد`,
        href: '/cheques',
      })
    }
    const outgoing = await db.cheque.count({ where: { direction: 'OUTGOING', status: 'ISSUED', dueDate: tomorrowDate } })
    if (outgoing > 0) {
      alerts.push({
        id: 'cheques-out',
        level: 'info',
        title: `يوجد ${outgoing} ${outgoing === 1 ? 'شيك صادر يستحق' : 'شيكات صادرة تستحق'} غدًا`,
        description: 'تأكد من توفر الرصيد في البنك',
        href: '/cheques?direction=OUTGOING',
      })
    }
  }

  if (can('treasury.view')) {
    const accounts = await db.cashAccount.findMany({ where: { isActive: true } })
    const totals = await accountsTotals(db, accounts.map((a) => a.glAccountId))
    for (const a of accounts) {
      const threshold = a.lowBalanceAlert !== null ? D(a.lowBalanceAlert) : a.type === 'CASHBOX' ? D(settings.finance.lowCashThreshold) : null
      if (!threshold || threshold.isZero()) continue
      const balance = totals.get(a.glAccountId)?.net ?? D(0)
      if (balance.lessThan(threshold)) {
        alerts.push({
          id: `low-${a.id}`,
          level: 'warning',
          title: `رصيد ${a.type === 'CASHBOX' ? 'الصندوق' : 'الحساب'} منخفض: ${a.name}`,
          description: `الرصيد الحالي ${formatAmount(balance, settings.finance.decimals)} ${settings.finance.currencySymbol}`,
          href: `/treasury/${a.id}`,
        })
      }
    }
  }

  if (can('years.manage')) {
    const current = await db.academicYear.findFirst({ where: { isCurrent: true } })
    if (current) {
      const left = diffDays(toDateOnly(current.endDate), today)
      if (left >= 0 && left <= 14) {
        alerts.push({
          id: 'year-end',
          level: 'info',
          title: `السنة الدراسية ${current.name} تنتهي خلال ${left} يومًا`,
          description: 'تذكير: أنشئ السنة الجديدة وقم بترحيل الطلاب',
          href: '/settings/years',
        })
      }
    }
  }

  if (can('backup.manage')) {
    const last = await latestSuccessfulBackupDate()
    const ageDays = last ? (Date.now() - last.getTime()) / 86_400_000 : Infinity
    if (ageDays > 2) {
      alerts.push({
        id: 'backup-old',
        level: 'danger',
        title: last ? `لم تُؤخذ نسخة احتياطية منذ ${Math.floor(ageDays)} أيام` : 'لا توجد أي نسخة احتياطية بعد',
        description: 'خذ نسخة احتياطية الآن من الإعدادات ← النسخ الاحتياطي',
        href: '/settings/backups',
      })
    }
  }

  if (can('settings.manage') && settings.school.name === 'المدرسة') {
    alerts.push({
      id: 'setup',
      level: 'info',
      title: 'أكمل بيانات المدرسة',
      description: 'اسم المدرسة، الشعار، العملة — لتظهر صحيحة في السندات والتقارير',
      href: '/settings',
    })
  }

  return alerts
}
