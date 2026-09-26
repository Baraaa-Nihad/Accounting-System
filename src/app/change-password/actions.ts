'use server'

import { getCurrentUser } from '@/server/auth/guard'
import { changeOwnPassword } from '@/server/auth/login'
import { toActionError, type ActionResult } from '@/server/errors'

export async function changePasswordAction(input: { current: string; next: string; confirm: string }): Promise<ActionResult<null>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'انتهت الجلسة، سجّل الدخول من جديد' }
  if (input.next !== input.confirm) {
    return { ok: false, error: 'تأكيد كلمة المرور غير مطابق', fieldErrors: { confirm: 'غير مطابق لكلمة المرور الجديدة' } }
  }
  try {
    await changeOwnPassword(user.id, user.sessionId, input.current, input.next)
    return { ok: true, data: null, message: 'تم تغيير كلمة المرور بنجاح' }
  } catch (e) {
    return toActionError(e)
  }
}
