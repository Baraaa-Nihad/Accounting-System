'use server'

import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { adjustContractorJob, createContractorJob, saveContractor, setJobStatus } from '@/server/services/parties'
import { adjustJobSchema, contractorSchema, jobSchema, jobStatusSchema } from '@/lib/schemas/treasury'

export async function saveContractorAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('contractors.manage')
    const data = contractorSchema.parse(input)
    const c = await transaction((tx) => saveContractor(tx, ctx, data))
    return ok({ id: c.id }, data.id ? 'تم حفظ البيانات' : `تمت إضافة ${c.name}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function createJobAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('contractors.manage')
    const data = jobSchema.parse(input)
    const j = await transaction((tx) => createContractorJob(tx, ctx, data))
    return ok({ id: j.id }, 'تم تسجيل العمل/الاتفاق')
  } catch (e) {
    return toActionError(e)
  }
}

export async function adjustJobAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('contractors.manage')
    const { id, ...data } = adjustJobSchema.parse(input)
    await transaction((tx) => adjustContractorJob(tx, ctx, id, data))
    return ok(null, 'تم تعديل قيمة الاتفاق')
  } catch (e) {
    return toActionError(e)
  }
}

export async function setJobStatusAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('contractors.manage')
    const { id, status, reason } = jobStatusSchema.parse(input)
    if (status === 'CANCELLED' && (!reason || reason.length < 3)) return { ok: false, error: 'اكتب سبب الإلغاء', fieldErrors: { reason: 'مطلوب' } }
    await transaction((tx) => setJobStatus(tx, ctx, id, status, reason ?? undefined))
    return ok(null, status === 'COMPLETED' ? 'تم إنهاء العمل' : status === 'CANCELLED' ? 'تم إلغاء العمل' : 'تمت إعادة فتح العمل')
  } catch (e) {
    return toActionError(e)
  }
}
