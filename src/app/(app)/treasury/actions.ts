'use server'

import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { cancelTransfer, createCashAccount, createTransfer, updateCashAccount } from '@/server/services/treasury'
import { cancelDocSchema, cashAccountSchema, transferSchema, updateCashAccountSchema } from '@/lib/schemas/treasury'

export async function createCashAccountAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('treasury.manage')
    const data = cashAccountSchema.parse(input)
    const a = await transaction((tx) => createCashAccount(tx, ctx, data))
    return ok({ id: a.id }, `تمت إضافة «${a.name}»`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateCashAccountAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('treasury.manage')
    const { id, ...data } = updateCashAccountSchema.parse(input)
    await transaction((tx) => updateCashAccount(tx, ctx, id, data))
    return ok(null, 'تم حفظ التعديلات')
  } catch (e) {
    return toActionError(e)
  }
}

export async function createTransferAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('treasury.transfer')
    const data = transferSchema.parse(input)
    const t = await transaction((tx) => createTransfer(tx, ctx, data))
    return ok({ id: t.id, number: t.number }, `تم التحويل ${t.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelTransferAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('treasury.manage')
    const { id, reason } = cancelDocSchema.parse(input)
    await transaction((tx) => cancelTransfer(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء التحويل')
  } catch (e) {
    return toActionError(e)
  }
}
