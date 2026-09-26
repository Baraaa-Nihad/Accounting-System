'use server'

import { z } from 'zod'
import { transaction } from '@/server/db'
import { actionContext, assertCan } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { promoteStudents } from '@/server/services/promotion'

const schema = z.object({
  fromYearId: z.coerce.number().int().positive(),
  toYearId: z.coerce.number().int().positive(),
  mapping: z.record(z.string(), z.number().int().positive().nullable()),
  overrides: z.record(z.string(), z.enum(['promote', 'repeat', 'graduate', 'skip'])),
  keepSections: z.boolean(),
  applyFees: z.boolean(),
})

export async function promoteStudentsAction(input: unknown): Promise<ActionResult<{ promoted: number; repeated: number; graduated: number; skipped: number; already: number; fees: number }>> {
  try {
    const ctx = await actionContext('students.promote')
    const data = schema.parse(input)
    if (data.applyFees) assertCan(ctx, 'charges.create', 'إصدار الرسوم يتطلب صلاحية إضافة الذمم')
    const res = await transaction((tx) => promoteStudents(tx, ctx, data), { timeout: 10 * 60_000 })
    return ok(res, `تم الترحيل: ${res.promoted} مرحّل، ${res.repeated} معيد، ${res.graduated} متخرج${data.applyFees ? `، و${res.fees} ذمة` : ''}`)
  } catch (e) {
    return toActionError(e)
  }
}
