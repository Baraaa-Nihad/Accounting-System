import type Decimal from 'decimal.js'
import { D, percentOf, round, splitEven } from './money'
import { addDays, addMonths, type DateOnly } from './dates'

/** توليد جدول أقساط متساوية (مشترك بين المعاينة في المتصفح والحفظ على الخادم). */
export function buildSchedule(
  net: Decimal,
  count: number,
  firstDueDate: DateOnly,
  decimals: number,
  dueDay?: number | null,
  monthsInterval = 1,
): { dueDate: DateOnly; amount: Decimal }[] {
  const amounts = splitEven(net, count, decimals)
  const day = dueDay ?? Number(firstDueDate.slice(8, 10))
  return amounts.map((amount, i) => ({
    dueDate: i === 0 ? firstDueDate : addMonths(firstDueDate, i * monthsInterval, day),
    amount,
  }))
}

export function previewDiscount(gross: string, method: 'PERCENT' | 'FIXED', value: string, decimals: number) {
  const g = D(gross || '0')
  const v = D(value || '0')
  const amount = method === 'PERCENT' ? percentOf(g, v, decimals) : round(v, decimals)
  return { gross: g, amount, net: g.minus(amount) }
}

export type InstallmentDisplay = 'NOT_DUE' | 'DUE' | 'OVERDUE' | 'PARTIAL' | 'PARTIAL_OVERDUE' | 'PAID' | 'CANCELLED'

/** حالة القسط المعروضة: تُحسب من حالة السداد وتاريخ الاستحقاق واليوم وأيام السماح. */
export function installmentDisplayStatus(
  inst: { status: string; dueDate: DateOnly; amount: string | Decimal; paidAmount: string | Decimal },
  today: DateOnly,
  graceDays: number,
): InstallmentDisplay {
  if (inst.status === 'CANCELLED') return 'CANCELLED'
  if (inst.status === 'PAID') return 'PAID'
  const paid = D(inst.paidAmount).greaterThan(0)
  const overdueBefore = addDays(today, -graceDays)
  if (inst.dueDate < overdueBefore) return paid ? 'PARTIAL_OVERDUE' : 'OVERDUE'
  if (inst.dueDate <= today) return paid ? 'PARTIAL' : 'DUE'
  return paid ? 'PARTIAL' : 'NOT_DUE'
}
