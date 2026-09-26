import 'server-only'
import type { Tx } from '../db'
import { D, toDb } from '@/lib/money'

/**
 * الرواتب (docs/05-workflows.md §5.17 – §5.19)
 */

/** إعادة حساب المدفوع من بند راتب من سندات الصرف الفعالة، وتحديث إجمالي المدفوع للمسير. */
export async function recomputePayrollItemPaid(tx: Tx, itemId: number) {
  const agg = await tx.paymentVoucher.aggregate({ where: { payrollItemId: itemId, status: 'ACTIVE' }, _sum: { amount: true } })
  const item = await tx.payrollItem.findUniqueOrThrow({ where: { id: itemId } })
  const paid = D(agg._sum.amount)
  const net = D(item.netPay)
  const paymentStatus = paid.isZero() ? 'UNPAID' : paid.greaterThanOrEqualTo(net) ? 'PAID' : 'PARTIAL'
  await tx.payrollItem.update({ where: { id: itemId }, data: { paidAmount: toDb(paid), paymentStatus } })
  await recomputeRunPaid(tx, item.payrollRunId)
}

export async function recomputeRunPaid(tx: Tx, runId: number) {
  const agg = await tx.payrollItem.aggregate({ where: { payrollRunId: runId }, _sum: { paidAmount: true } })
  await tx.payrollRun.update({ where: { id: runId }, data: { totalPaid: toDb(D(agg._sum.paidAmount)) } })
}
