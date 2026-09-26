import 'server-only'
import { BusinessError } from '../errors'

/** تنفيذ عملية صف مع إرفاق رقم الصف بأي خطأ عمل (لتحديد موضع المشكلة في الملف). */
export async function atRow<T>(rowNumber: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof BusinessError) throw new BusinessError(`الصف ${rowNumber}: ${e.message}`, e.fieldErrors)
    throw e
  }
}
