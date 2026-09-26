'use server'

import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, BusinessError, type ActionResult } from '@/server/errors'
import { deleteAttachment, saveAttachment } from '@/server/services/attachments'

export async function uploadAttachmentAction(formData: FormData): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext()
    const entityType = String(formData.get('entityType') ?? '')
    const entityId = Number(formData.get('entityId'))
    const file = formData.get('file')
    if (!(file instanceof File)) throw new BusinessError('اختر ملفًا')
    if (!Number.isInteger(entityId) || entityId <= 0) throw new BusinessError('مرجع غير صالح')
    const description = String(formData.get('description') ?? '').slice(0, 300) || null
    const att = await saveAttachment(ctx, { entityType, entityId, file, description })
    return ok({ id: att.id }, 'تم رفع المرفق')
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteAttachmentAction(id: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext()
    await deleteAttachment(ctx, id)
    return ok(null, 'تم حذف المرفق')
  } catch (e) {
    return toActionError(e)
  }
}
