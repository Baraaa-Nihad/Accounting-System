'use server'

import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { deletePartner, savePartner } from '@/server/services/partners'
import { id as idSchema } from '@/lib/schemas/common'
import { partnerSchema } from '@/lib/schemas/users'

export async function savePartnerAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('partners.manage')
    const { id, ...data } = partnerSchema.parse(input)
    const p = await transaction((tx) => savePartner(tx, ctx, { ...data, id: id ?? null }))
    return ok({ id: p.id }, id ? 'تم حفظ بيانات الشريك' : `تمت إضافة الشريك ${p.name} وإنشاء حساباته`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function deletePartnerAction(partnerId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('partners.manage')
    await transaction((tx) => deletePartner(tx, ctx, idSchema.parse(partnerId)))
    return ok(null, 'تم حذف الشريك')
  } catch (e) {
    return toActionError(e)
  }
}
