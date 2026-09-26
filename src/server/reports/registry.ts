import 'server-only'
import type { ReportDef } from './types'
import { collections, discounts, dueMonth, dueToday, dueWeek, lateStudents, overdueInstallments, studentBalances } from './defs/students'
import { receiptsReport, vouchersReport } from './defs/documents'
import { expensesReport, profitLoss, revenuesReport } from './defs/pnl'
import { advancesReport, employeesReport, payrollReport, suppliersReport } from './defs/staff'
import { bankReport, cashboxReport } from './defs/treasury'
import { byChargeType, byGrade, byStudent, byYear } from './defs/financial'
import { balanceSheetReport, trialBalanceReport } from './defs/accounting'
import { canSeeSalaries, type CurrentUser } from '../auth/guard'

/** التقارير الـ 23 بالترتيب المطلوب. */
export const REPORTS: ReportDef[] = [
  studentBalances, // 1
  lateStudents, // 2
  dueToday, // 3
  dueWeek, // 4
  dueMonth, // 5
  overdueInstallments, // 6
  collections, // 7
  discounts, // 8
  receiptsReport, // 9
  vouchersReport, // 10
  revenuesReport, // 11
  expensesReport, // 12
  payrollReport, // 13
  advancesReport, // 14
  employeesReport, // 15
  suppliersReport, // 16
  cashboxReport, // 17
  bankReport, // 18
  profitLoss, // 19
  byYear, // 20
  byGrade, // 21
  byStudent, // 22
  byChargeType, // 23
]

/** القوائم المحاسبية (خارج قائمة التقارير الـ 23 المرقمة، وتستخدم نفس المحرك). */
export const ACCOUNTING_REPORTS: ReportDef[] = [trialBalanceReport, balanceSheetReport]

export function getReport(id: string): ReportDef | null {
  return REPORTS.find((r) => r.id === id) ?? ACCOUNTING_REPORTS.find((r) => r.id === id) ?? null
}

/** هل يستطيع المستخدم فتح التقرير؟ (عرض التقارير + صلاحية التقرير + الرواتب إن لزم) */
export function canOpenReport(user: CurrentUser, def: ReportDef): boolean {
  if (!user.permissions.has('reports.view')) return false
  if (!def.permissions.some((p) => user.permissions.has(p))) return false
  if (def.salaries && !canSeeSalaries(user)) return false
  return true
}
