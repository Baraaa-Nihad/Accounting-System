import { z } from 'zod'

/**
 * خطأ عمل: رسالته عربية موجهة للمستخدم (مثل: «المبلغ أكبر من رصيد الصندوق»).
 * أي خطأ آخر يُعتبر خطأ داخليًا ولا تُعرض تفاصيله للمستخدم.
 */
export class BusinessError extends Error {
  readonly fieldErrors?: Record<string, string>
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = 'BusinessError'
    this.fieldErrors = fieldErrors
  }
}

export class PermissionError extends BusinessError {
  constructor(message = 'لا تملك صلاحية تنفيذ هذه العملية') {
    super(message)
    this.name = 'PermissionError'
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message }
}

/** يحوّل أي خطأ إلى نتيجة آمنة للعرض في الواجهة. */
export function toActionError(error: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (error instanceof BusinessError) {
    return { ok: false, error: error.message, fieldErrors: error.fieldErrors }
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.')
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { ok: false, error: 'يرجى تصحيح الحقول المشار إليها', fieldErrors }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('JOURNAL_UNBALANCED')) {
    return { ok: false, error: 'تعذر الحفظ: القيد المحاسبي غير متوازن' }
  }
  if (message.includes('IMMUTABLE_RECORD')) {
    return { ok: false, error: 'لا يمكن تعديل أو حذف هذه الحركة المالية' }
  }
  if (/Unique constraint|P2002/.test(message)) {
    return { ok: false, error: 'القيمة المدخلة مستخدمة مسبقًا (يجب أن تكون فريدة)' }
  }
  if (/violates check constraint/.test(message)) {
    return { ok: false, error: 'تعذر الحفظ: القيم المدخلة تخالف قواعد سلامة البيانات' }
  }
  console.error('[action error]', error)
  return { ok: false, error: 'حدث خطأ غير متوقع. لم يتم حفظ أي تغيير.' }
}
