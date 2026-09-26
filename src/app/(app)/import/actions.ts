'use server'

import { z } from 'zod'
import { db } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { BusinessError, ok, toActionError, type ActionResult } from '@/server/errors'
import { MAX_IMPORT_BYTES } from '@/server/import/parse'
import { commitSession, createImportSession, loadSession, saveSessionSettings } from '@/server/import/service'
import type { CommitResult } from '@/server/import/types'
import { id as idSchema } from '@/lib/schemas/common'

export async function uploadImportAction(formData: FormData): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('import.excel')
    const type = String(formData.get('type') ?? '')
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) throw new BusinessError('اختر ملف Excel أو CSV')
    if (file.size > MAX_IMPORT_BYTES) throw new BusinessError('حجم الملف أكبر من 10 ميغابايت')
    const batch = await createImportSession(ctx, { type, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) })
    return ok({ id: batch.id }, `تمت قراءة ${batch.totalRows} صف من الملف`)
  } catch (e) {
    return toActionError(e)
  }
}

const settingsSchema = z.object({
  id: idSchema,
  mapping: z.record(z.string(), z.number().int().min(0).nullable()),
  options: z.object({
    yearId: z.number().int().positive().nullable(),
    duplicates: z.enum(['skip', 'update']),
    createMissing: z.boolean(),
    cashAccountId: z.number().int().positive().nullable(),
  }),
})

export async function saveImportSettingsAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('import.excel')
    const data = settingsSchema.parse(input)
    await saveSessionSettings(ctx, data.id, { mapping: data.mapping, options: data.options })
    return ok(null, 'تم تطبيق الربط والخيارات، راجع نتيجة التحقق')
  } catch (e) {
    return toActionError(e)
  }
}

export async function commitImportAction(batchId: number): Promise<ActionResult<CommitResult>> {
  try {
    const ctx = await actionContext('import.excel')
    const res = await commitSession(ctx, idSchema.parse(batchId))
    return ok(res, `تم الاستيراد: ${res.created} جديد${res.updated ? `، ${res.updated} محدث` : ''}`)
  } catch (e) {
    return toActionError(e)
  }
}

/** إلغاء جلسة لم تُنفذ (لا تحتوي أي بيانات مالية، فتُحذف مباشرة). */
export async function discardImportAction(batchId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('import.excel')
    const s = await loadSession(ctx, idSchema.parse(batchId))
    if (s.status !== 'PENDING') throw new BusinessError('لا يمكن إلغاء استيراد تم تنفيذه')
    await db.importBatch.deleteMany({ where: { id: s.id, status: 'PENDING' } })
    return ok(null, 'تم إلغاء جلسة الاستيراد')
  } catch (e) {
    return toActionError(e)
  }
}
