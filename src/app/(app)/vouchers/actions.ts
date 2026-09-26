'use server'

import { db, transaction } from '@/server/db'
import { actionContext, assertCan } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { cancelVoucher, createVoucher } from '@/server/services/vouchers'
import { studentCredit } from '@/server/services/receipts'
import { cancelDocSchema, voucherSchema } from '@/lib/schemas/treasury'

export async function createVoucherAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('vouchers.create')
    const data = voucherSchema.parse(input)
    if (data.kind === 'SALARY') assertCan(ctx, 'payroll.pay', 'صرف الرواتب يتطلب صلاحية «صرف الرواتب»')
    if (data.kind === 'ADVANCE') assertCan(ctx, 'advances.manage', 'صرف السلف يتطلب صلاحية «إدارة السلف»')
    const v = await transaction((tx) => createVoucher(tx, ctx, data))
    return ok({ id: v.id, number: v.number }, `تم حفظ سند الصرف ${v.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelVoucherAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('vouchers.cancel')
    const { id, reason } = cancelDocSchema.parse(input)
    await transaction((tx) => cancelVoucher(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء سند الصرف')
  } catch (e) {
    return toActionError(e)
  }
}

/** بيانات مرتجع الطالب: الرصيد الدائن المتاح واسم ولي الأمر. */
export async function loadRefundContextAction(studentId: number): Promise<ActionResult<{ credit: string; payeeName: string }>> {
  try {
    await actionContext('vouchers.create')
    const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, include: { guardian: true } })
    const credit = await studentCredit(db, s.id)
    return ok({ credit: credit.toString(), payeeName: s.guardian?.name ?? s.fullName })
  } catch (e) {
    return toActionError(e)
  }
}
