'use server'

import { z } from 'zod'
import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { createAccount, createManualEntry, reverseManualEntry, updateAccount } from '@/server/services/accounting'
import { cancelReason, dateOnly, id as idSchema, optionalAmount, optionalText, requiredText } from '@/lib/schemas/common'

const accountSchema = z.object({
  parentId: idSchema,
  name: requiredText('اسم الحساب مطلوب', 2, 120),
  code: optionalText(20),
  description: optionalText(300),
  isGroup: z.boolean().default(false),
})

export async function createAccountAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('accounting.manage')
    const data = accountSchema.parse(input)
    const acc = await transaction((tx) => createAccount(tx, ctx, data))
    return ok({ id: acc.id }, `تمت إضافة الحساب ${acc.code}`)
  } catch (e) {
    return toActionError(e)
  }
}

const updateSchema = z.object({ id: idSchema, name: requiredText('اسم الحساب مطلوب', 2, 120), description: optionalText(300), isActive: z.boolean() })

export async function updateAccountAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('accounting.manage')
    const { id, ...data } = updateSchema.parse(input)
    await transaction((tx) => updateAccount(tx, ctx, id, data))
    return ok(null, 'تم حفظ الحساب')
  } catch (e) {
    return toActionError(e)
  }
}

const entrySchema = z.object({
  date: dateOnly,
  description: requiredText('بيان القيد مطلوب', 3, 500),
  lines: z
    .array(z.object({ accountId: idSchema, debit: optionalAmount, credit: optionalAmount, description: optionalText(300) }))
    .min(2, 'القيد يحتاج طرفين على الأقل')
    .max(100, 'الحد الأقصى 100 سطر'),
})

export async function createManualEntryAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('accounting.manage')
    const data = entrySchema.parse(input)
    const entry = await transaction((tx) => createManualEntry(tx, ctx, data))
    return ok({ id: entry.id, number: entry.number }, `تم ترحيل القيد ${entry.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

const reverseSchema = z.object({ id: idSchema, date: dateOnly, reason: cancelReason })

export async function reverseManualEntryAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('accounting.manage')
    const data = reverseSchema.parse(input)
    const rev = await transaction((tx) => reverseManualEntry(tx, ctx, data.id, { date: data.date, reason: data.reason }))
    return ok({ id: rev.id }, `تم عكس القيد بالقيد ${rev.number}`)
  } catch (e) {
    return toActionError(e)
  }
}
