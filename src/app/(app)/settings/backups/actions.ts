'use server'

import { z } from 'zod'
import { db } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { verifyPassword } from '@/server/auth/password'
import { BusinessError, ok, toActionError, type ActionResult } from '@/server/errors'
import { createBackup, deleteBackup, restoreBackup, verifyBackup } from '@/server/backup/engine'
import { clearSessionCookie } from '@/server/auth/session'
import { RESTORE_PHRASE } from '@/lib/backup-constants'

const nameSchema = z.string().regex(/^backup-[\w.-]+\.bak$/, 'اسم نسخة غير صالح')

export async function createBackupAction(): Promise<ActionResult<{ fileName: string }>> {
  try {
    const ctx = await actionContext('backup.manage')
    const meta = await createBackup('manual', ctx)
    return ok({ fileName: meta.fileName }, 'تم إنشاء النسخة الاحتياطية المشفرة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function verifyBackupAction(fileName: string): Promise<ActionResult<{ files: number; createdAt: string }>> {
  try {
    await actionContext('backup.manage')
    const res = await verifyBackup(nameSchema.parse(fileName))
    return ok({ files: res.files, createdAt: res.manifest.createdAt }, `النسخة سليمة وتُفك بالمفتاح الحالي (${res.files} ملف مرفق)`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteBackupAction(fileName: string): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('backup.manage')
    await deleteBackup(nameSchema.parse(fileName), ctx)
    return ok(null, 'تم حذف النسخة')
  } catch (e) {
    return toActionError(e)
  }
}

const restoreSchema = z.object({ fileName: nameSchema, password: z.string().min(1, 'أدخل كلمة المرور'), phrase: z.string() })

/** الاستعادة: كلمة مرور المستخدم + عبارة التأكيد، ثم تنتهي كل الجلسات. */
export async function restoreBackupAction(input: unknown): Promise<ActionResult<{ safety: string }>> {
  try {
    const ctx = await actionContext('backup.manage')
    const data = restoreSchema.parse(input)
    if (data.phrase.trim() !== RESTORE_PHRASE) throw new BusinessError(`اكتب «${RESTORE_PHRASE}» للتأكيد`, { phrase: 'عبارة التأكيد غير صحيحة' })
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId! } })
    if (!(await verifyPassword(data.password, user.passwordHash))) throw new BusinessError('كلمة المرور غير صحيحة', { password: 'غير صحيحة' })
    const res = await restoreBackup(data.fileName, ctx)
    await clearSessionCookie()
    return ok({ safety: res.safety }, `تمت الاستعادة. سجّل الدخول من جديد.${res.needsMigration ? ' النسخة من إصدار أقدم: شغّل ترقية القاعدة (npx prisma migrate deploy).' : ''}`)
  } catch (e) {
    return toActionError(e)
  }
}
