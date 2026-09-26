import { D, round } from './money'

/**
 * حساب بند راتب لموظف (docs/05-workflows.md §5.19) — دالة نقية تُستخدم في الخادم وفي معاينة الجدول.
 *
 *  الأساسي المستحق: شهري = الراتب × (أيام العمل ÷ أيام الشهر)؛ يومي = الأجر × الأيام؛ بالساعة = الأجر × الساعات
 *  خصم الغياب  = الأجر اليومي × أيام الغياب
 *  خصم التأخير = أجر الساعة × ساعات التأخير
 *  الإجمالي    = الأساسي + الإضافي + المكافآت + البدلات
 *  الصافي      = الإجمالي − الغياب − التأخير − الخصومات − الاستقطاعات − قسط السلفة
 *  قسط السلفة يُخفض تلقائيًا إذا تجاوز المتاح حتى لا يصبح الصافي سالبًا.
 */

export type SalaryKind = 'MONTHLY' | 'DAILY' | 'HOURLY'

export interface PayrollCalcInput {
  salaryType: SalaryKind
  rate: string
  workDays: string
  workHours: string
  absenceDays: string
  lateHours: string
  overtimeAmount: string
  bonuses: string
  allowances: string
  otherDeductions: string
  withholdings: string
  /** مجموع أقساط السلف المستحقة هذا الشهر قبل التخفيض */
  plannedAdvance: string
}

export interface PayrollCalcConfig {
  workDaysPerMonth: number
  hoursPerDay: number
  decimals: number
}

export interface PayrollCalcResult {
  basicPay: string
  absenceDeduction: string
  lateDeduction: string
  grossPay: string
  advanceDeduction: string
  totalDeductions: string
  netPay: string
  /** خطأ يمنع الاعتماد (خصومات أكبر من الإجمالي) */
  error: string | null
}

const n = (v: string | number | null | undefined) => {
  const d = D(v === '' || v === null || v === undefined ? 0 : v)
  return d.isNegative() ? D(0) : d
}

export function calcPayrollItem(i: PayrollCalcInput, cfg: PayrollCalcConfig): PayrollCalcResult {
  const rate = n(i.rate)
  const monthDays = D(cfg.workDaysPerMonth)
  const hoursPerDay = D(cfg.hoursPerDay)
  const workDays = n(i.workDays)
  const r = (x: ReturnType<typeof D>) => round(x, cfg.decimals)

  let basic: ReturnType<typeof D>
  let daily: ReturnType<typeof D>
  let hourly: ReturnType<typeof D>
  switch (i.salaryType) {
    case 'MONTHLY':
      basic = workDays.equals(monthDays) ? rate : rate.dividedBy(monthDays).times(workDays)
      daily = rate.dividedBy(monthDays)
      hourly = rate.dividedBy(monthDays.times(hoursPerDay))
      break
    case 'DAILY':
      basic = rate.times(workDays)
      daily = rate
      hourly = rate.dividedBy(hoursPerDay)
      break
    case 'HOURLY':
      basic = rate.times(n(i.workHours))
      daily = rate.times(hoursPerDay)
      hourly = rate
      break
  }
  const basicPay = r(basic)
  const absence = r(daily.times(n(i.absenceDays)))
  const late = r(hourly.times(n(i.lateHours)))
  const gross = basicPay.plus(r(n(i.overtimeAmount))).plus(r(n(i.bonuses))).plus(r(n(i.allowances)))
  const beforeAdvance = gross.minus(absence).minus(late).minus(r(n(i.otherDeductions))).minus(r(n(i.withholdings)))
  const planned = r(n(i.plannedAdvance))
  const available = beforeAdvance.isNegative() ? D(0) : beforeAdvance
  const advance = planned.greaterThan(available) ? available : planned
  const totalDeductions = absence.plus(late).plus(r(n(i.otherDeductions))).plus(r(n(i.withholdings))).plus(advance)
  const net = gross.minus(totalDeductions)
  return {
    basicPay: basicPay.toString(),
    absenceDeduction: absence.toString(),
    lateDeduction: late.toString(),
    grossPay: gross.toString(),
    advanceDeduction: advance.toString(),
    totalDeductions: totalDeductions.toString(),
    netPay: net.toString(),
    error: net.isNegative() ? 'الخصومات أكبر من إجمالي الراتب' : null,
  }
}
