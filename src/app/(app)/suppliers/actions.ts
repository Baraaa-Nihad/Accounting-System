'use server'

import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { cancelSupplierBill, createSupplierBill, saveSupplier } from '@/server/services/parties'
import { billSchema, cancelDocSchema, supplierSchema } from '@/lib/schemas/treasury'

export async function saveSupplierAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('suppliers.manage')
    const data = supplierSchema.parse(input)
    const s = await transaction((tx) => saveSupplier(tx, ctx, data))
    return ok({ id: s.id }, data.id ? 'تم حفظ بيانات المورد' : `تمت إضافة المورد ${s.name}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function createBillAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('suppliers.manage')
    const data = billSchema.parse(input)
    const b = await transaction((tx) => createSupplierBill(tx, ctx, data))
    return ok({ id: b.id, number: b.number }, data.isOpening ? 'تم تسجيل الرصيد الافتتاحي للمورد' : `تم تسجيل الفاتورة ${b.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelBillAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('suppliers.manage')
    const { id, reason } = cancelDocSchema.parse(input)
    await transaction((tx) => cancelSupplierBill(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء الفاتورة')
  } catch (e) {
    return toActionError(e)
  }
}
