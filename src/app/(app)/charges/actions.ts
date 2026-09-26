'use server'

import { transaction, db } from '@/server/db'
import { actionContext, assertCan } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import {
  addDiscount,
  cancelCharge,
  cancelDiscount,
  createBulkCharges,
  createCharge,
  previewBulkCharges,
  rescheduleCharge,
  saveFeePlan,
  type BulkPreviewRow,
} from '@/server/services/charges'
import { audit } from '@/server/audit'
import {
  addDiscountSchema,
  bulkChargeSchema,
  cancelSchema,
  createChargeSchema,
  feePlanSchema,
  rescheduleSchema,
} from '@/lib/schemas/charges'

export async function createChargeAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('charges.create')
    const data = createChargeSchema.parse(input)
    if (data.discount) assertCan(ctx, 'discounts.create', 'لا تملك صلاحية إضافة الخصومات')
    const charge = await transaction((tx) =>
      createCharge(tx, ctx, {
        ...data,
        discount: data.discount ?? null,
        installments: data.installments
          ? {
              count: data.installments.count,
              firstDueDate: data.installments.firstDueDate,
              dueDay: data.installments.dueDay,
              schedule: data.installments.schedule ?? null,
            }
          : null,
      }),
    )
    return ok({ id: charge.id }, 'تمت إضافة الذمة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function addDiscountAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('discounts.create')
    const data = addDiscountSchema.parse(input)
    const d = await transaction((tx) => addDiscount(tx, ctx, data))
    return ok({ id: d.id }, 'تم تطبيق الخصم')
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelDiscountAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('discounts.cancel')
    const { id, reason } = cancelSchema.parse(input)
    await transaction((tx) => cancelDiscount(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء الخصم')
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelChargeAction(input: unknown): Promise<ActionResult<{ movedToCredit: string }>> {
  try {
    const ctx = await actionContext('charges.cancel')
    const { id, reason } = cancelSchema.parse(input)
    const res = await transaction((tx) => cancelCharge(tx, ctx, id, reason))
    return ok(res, 'تم إلغاء الذمة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function rescheduleChargeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('charges.edit')
    const data = rescheduleSchema.parse(input)
    await transaction((tx) => rescheduleCharge(tx, ctx, data.chargeId, data))
    return ok(null, 'تمت إعادة جدولة الأقساط')
  } catch (e) {
    return toActionError(e)
  }
}

export async function previewBulkAction(input: unknown): Promise<ActionResult<BulkPreviewRow[]>> {
  try {
    await actionContext('charges.create')
    const data = bulkChargeSchema.parse(input)
    return ok(await previewBulkCharges(db, data))
  } catch (e) {
    return toActionError(e)
  }
}

export async function createBulkAction(input: unknown): Promise<ActionResult<{ created: number; skipped: number; total: string }>> {
  try {
    const ctx = await actionContext('charges.create')
    const data = bulkChargeSchema.parse(input)
    const res = await transaction((tx) => createBulkCharges(tx, ctx, data), { timeout: 300_000 })
    return ok(res, `تم إصدار ${res.created} ذمة`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function saveFeePlanAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('feeplans.manage')
    const data = feePlanSchema.parse(input)
    await transaction((tx) => saveFeePlan(tx, ctx, data))
    return ok(null, 'تم حفظ الرسوم المقررة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteFeePlanAction(id: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('feeplans.manage')
    await transaction(async (tx) => {
      const plan = await tx.feePlan.findUniqueOrThrow({ where: { id } })
      await tx.feePlan.delete({ where: { id } })
      await audit(tx, ctx, { action: 'delete', entityType: 'FeePlan', entityId: id, before: plan })
    })
    return ok(null, 'تم حذف الرسوم المقررة')
  } catch (e) {
    return toActionError(e)
  }
}
