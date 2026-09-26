import 'server-only'
import type { InstallmentStatus, PaymentStatus } from '@/generated/prisma/enums'
import type { Tx } from '../db'
import { BusinessError } from '../errors'
import { D, splitEven, sum, toDb, ZERO } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import { buildSchedule } from '@/lib/schedule'
import type Decimal from 'decimal.js'

/**
 * أدوات الأقساط المشتركة: توليد الجدول، إعادة الحساب من التوزيعات، إعادة التوزيع بعد الخصم.
 * القاعدة: مجموع الأقساط غير الملغاة = صافي الذمة دائمًا.
 */

export interface ScheduleLine {
  dueDate: DateOnly
  amount: Decimal
}

/** توليد جدول أقساط متساوية: فرق التقريب لآخر قسط، ويوم الاستحقاق ثابت (31 → آخر الشهر). */
export function generateSchedule(
  net: Decimal,
  count: number,
  firstDueDate: DateOnly,
  decimals: number,
  dueDay?: number | null,
  monthsInterval = 1,
): ScheduleLine[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new BusinessError('عدد الأقساط يجب أن يكون بين 1 و 60')
  if (dueDay !== null && dueDay !== undefined && (dueDay < 1 || dueDay > 31)) throw new BusinessError('يوم الاستحقاق بين 1 و 31')
  return buildSchedule(net, count, firstDueDate, decimals, dueDay, monthsInterval)
}

export function validateCustomSchedule(schedule: { dueDate: DateOnly; amount: string | Decimal }[], net: Decimal) {
  if (schedule.length < 1 || schedule.length > 60) throw new BusinessError('عدد الأقساط يجب أن يكون بين 1 و 60')
  for (const line of schedule) {
    if (D(line.amount).isNegative()) throw new BusinessError('مبلغ القسط لا يمكن أن يكون سالبًا')
  }
  const total = sum(schedule.map((l) => l.amount))
  if (!total.equals(net)) {
    throw new BusinessError(`مجموع الأقساط (${total.toFixed(2)}) يجب أن يساوي المبلغ النهائي بعد الخصم (${net.toFixed(2)})`)
  }
}

export function paymentStatusOf(amount: Decimal, paid: Decimal): PaymentStatus {
  if (amount.isZero() || paid.greaterThanOrEqualTo(amount)) return 'PAID'
  if (paid.isZero()) return 'UNPAID'
  return 'PARTIAL'
}

/** إعادة حساب المدفوع وحالة القسط من توزيعات سندات القبض الفعالة فقط. */
export async function recomputeInstallment(tx: Tx, installmentId: number) {
  const inst = await tx.installment.findUnique({ where: { id: installmentId } })
  if (!inst) return
  const agg = await tx.$queryRaw<{ paid: string; lastDate: Date | null }[]>`
    SELECT COALESCE(SUM(pa."amount"), 0)::text AS paid, MAX(r."date") AS "lastDate"
    FROM "payment_allocations" pa JOIN "receipts" r ON r."id" = pa."receiptId"
    WHERE pa."installmentId" = ${installmentId} AND r."status" = 'ACTIVE'`
  const paid = D(agg[0]?.paid)
  const amount = D(inst.amount)
  if (paid.greaterThan(amount)) throw new BusinessError('المبلغ الموزع على القسط أكبر من قيمته')
  const status: InstallmentStatus = inst.status === 'CANCELLED' ? 'CANCELLED' : paymentStatusOf(amount, paid)
  await tx.installment.update({
    where: { id: installmentId },
    data: {
      paidAmount: toDb(paid),
      status,
      paidAt: status === 'PAID' && !amount.isZero() ? agg[0]?.lastDate ?? null : null,
    },
  })
}

/** إعادة حساب الخصم والصافي والمدفوع وحالة الذمة. */
export async function recomputeCharge(tx: Tx, chargeId: number) {
  const charge = await tx.charge.findUnique({ where: { id: chargeId } })
  if (!charge) return
  const discountAgg = await tx.$queryRaw<{ amount: string }[]>`
    SELECT COALESCE(SUM(da."amount"), 0)::text AS amount
    FROM "discount_applications" da JOIN "discounts" d ON d."id" = da."discountId"
    WHERE da."chargeId" = ${chargeId} AND d."status" = 'ACTIVE'`
  const paidAgg = await tx.installment.aggregate({
    where: { chargeId, status: { not: 'CANCELLED' } },
    _sum: { paidAmount: true },
  })
  const gross = D(charge.grossAmount)
  const discount = D(discountAgg[0]?.amount)
  if (discount.greaterThan(gross)) throw new BusinessError('مجموع الخصومات أكبر من قيمة الذمة')
  const net = gross.minus(discount)
  const paid = D(paidAgg._sum.paidAmount)
  if (paid.greaterThan(net)) throw new BusinessError('المدفوع على الذمة أكبر من صافيها بعد الخصم')
  await tx.charge.update({
    where: { id: chargeId },
    data: {
      discountAmount: toDb(discount),
      netAmount: toDb(net),
      paidAmount: toDb(paid),
      paymentStatus: paymentStatusOf(net, paid),
    },
  })
  return { gross, discount, net, paid }
}

/**
 * إعادة توزيع الأقساط غير المدفوعة لتساوي صافي الذمة الجديد (بعد خصم أو إلغاء خصم):
 * - الأقساط التي دُفع منها شيء لا تتغير (إلا عند الضرورة: تُخفض حتى ما دُفع منها)
 * - EVEN: بالتساوي على الأقساط التي لم يُدفع منها شيء
 * - FROM_LAST: التخفيض من آخر الأقساط
 */
export async function redistributeInstallments(
  tx: Tx,
  chargeId: number,
  decimals: number,
  mode: 'EVEN' | 'FROM_LAST' = 'EVEN',
) {
  const charge = await tx.charge.findUniqueOrThrow({ where: { id: chargeId } })
  const net = D(charge.netAmount)
  const all = await tx.installment.findMany({
    where: { chargeId, status: { not: 'CANCELLED' } },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  })
  if (all.length === 0) return
  const paidOnes = all.filter((i) => D(i.paidAmount).greaterThan(0))
  const free = all.filter((i) => D(i.paidAmount).isZero())
  let fixedSum = sum(paidOnes.map((i) => i.amount))
  let remainingForFree = net.minus(fixedSum)
  const updates = new Map<number, Decimal>()

  if (remainingForFree.isNegative()) {
    // تخفيض الأقساط المدفوعة جزئيًا من الأخير حتى حد ما دُفع منها
    let excess = remainingForFree.abs()
    for (const inst of [...paidOnes].reverse()) {
      if (excess.isZero()) break
      const room = D(inst.amount).minus(D(inst.paidAmount))
      const cut = excess.lessThan(room) ? excess : room
      if (cut.greaterThan(0)) {
        updates.set(inst.id, D(inst.amount).minus(cut))
        excess = excess.minus(cut)
      }
    }
    if (excess.greaterThan(0)) throw new BusinessError('لا يمكن أن يقل صافي الذمة عن المبلغ المدفوع منها')
    fixedSum = sum(paidOnes.map((i) => updates.get(i.id) ?? D(i.amount)))
    remainingForFree = net.minus(fixedSum)
    for (const inst of free) updates.set(inst.id, ZERO)
  } else if (free.length > 0) {
    const currentFree = sum(free.map((i) => i.amount))
    if (mode === 'FROM_LAST' && currentFree.greaterThanOrEqualTo(remainingForFree)) {
      let cut = currentFree.minus(remainingForFree)
      for (const inst of [...free].reverse()) {
        const amt = D(inst.amount)
        const c = cut.lessThan(amt) ? cut : amt
        updates.set(inst.id, amt.minus(c))
        cut = cut.minus(c)
      }
    } else {
      const parts = splitEven(remainingForFree, free.length, decimals)
      free.forEach((inst, i) => updates.set(inst.id, parts[i]))
    }
  } else if (remainingForFree.greaterThan(0)) {
    // كل الأقساط مدفوع منها: الزيادة تُضاف لآخر قسط
    const last = all[all.length - 1]
    updates.set(last.id, D(last.amount).plus(remainingForFree))
  }

  for (const [id, amount] of updates) {
    await tx.installment.update({ where: { id }, data: { amount: toDb(amount) } })
    await recomputeInstallment(tx, id)
  }
  const check = await tx.installment.aggregate({ where: { chargeId, status: { not: 'CANCELLED' } }, _sum: { amount: true } })
  if (!D(check._sum.amount).equals(net)) {
    throw new Error(`INSTALLMENTS_MISMATCH charge ${chargeId}: ${D(check._sum.amount)} != ${net}`)
  }
}

export function scheduleToRows(schedule: ScheduleLine[]) {
  return schedule.map((l, i) => ({ number: i + 1, dueDate: fromDateOnly(l.dueDate), amount: toDb(l.amount) }))
}

export function dateOnlyOf(d: Date): DateOnly {
  return toDateOnly(d)
}
