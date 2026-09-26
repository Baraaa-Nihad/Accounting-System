import 'server-only'
import type { PaymentMethod } from '@/generated/prisma/enums'
import type { Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings } from '../settings'
import { assertSufficientBalance } from './treasury'
import { createVoucher } from './vouchers'
import { runLabel } from './payroll'
import { D, sum } from '@/lib/money'
import type { DateOnly } from '@/lib/dates'

/**
 * صرف رواتب مسير معتمد (docs/05-workflows.md §5.19 الخطوة 5):
 * سند صرف «راتب» لكل موظف بالمتبقي من صافي راتبه: م رواتب مستحقة / د الصندوق أو البنك.
 */
export async function paySalaries(
  tx: Tx,
  ctx: Ctx,
  input: { runId: number; itemIds?: number[] | null; date: DateOnly; cashAccountId: number; paymentMethod: PaymentMethod; referenceNumber?: string | null },
) {
  const { finance } = await getSettings(tx)
  const run = await tx.payrollRun.findUnique({ where: { id: input.runId } })
  if (!run) throw new BusinessError('المسير غير موجود')
  if (run.status !== 'APPROVED') throw new BusinessError('يجب اعتماد المسير قبل صرف الرواتب')
  if (input.paymentMethod === 'CHEQUE') throw new BusinessError('للصرف بشيك اصرف راتب كل موظف على حدة من سند صرف «راتب»')
  const items = await tx.payrollItem.findMany({
    where: { payrollRunId: run.id, ...(input.itemIds?.length ? { id: { in: input.itemIds } } : {}) },
    include: { employee: true },
    orderBy: { id: 'asc' },
  })
  const due = items
    .map((it) => ({ it, remaining: D(it.netPay).minus(D(it.paidAmount)) }))
    .filter((x) => x.remaining.greaterThan(0))
  if (due.length === 0) throw new BusinessError('لا توجد رواتب متبقية للصرف')
  const total = sum(due.map((x) => x.remaining))
  // فحص مبدئي بالمجموع لرسالة أوضح (كل سند يُفحص أيضًا)
  await assertSufficientBalance(tx, input.cashAccountId, total)
  const numbers: string[] = []
  for (const { it, remaining } of due) {
    const v = await createVoucher(tx, ctx, {
      kind: 'SALARY',
      date: input.date,
      amount: remaining.toString(),
      paymentMethod: input.paymentMethod,
      cashAccountId: input.cashAccountId,
      payrollItemId: it.id,
      referenceNumber: input.referenceNumber ?? null,
      description: `راتب شهر ${runLabel(run)}`,
    })
    numbers.push(v.number)
  }
  await audit(tx, ctx, {
    action: 'pay',
    entityType: 'PayrollRun',
    entityId: run.id,
    entityLabel: `مسير رواتب ${runLabel(run)}`,
    summary: `صرف رواتب ${runLabel(run)} لـ ${due.length} موظف بمجموع ${total.toFixed(finance.decimals)} (السندات ${numbers[0]}${numbers.length > 1 ? ` … ${numbers[numbers.length - 1]}` : ''})`,
  })
  return { count: due.length, total: total.toString(), numbers }
}
