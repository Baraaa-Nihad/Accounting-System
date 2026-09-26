'use server'

import { z } from 'zod'
import { db, transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { audit } from '@/server/audit'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { optionalText, requiredText } from '@/lib/schemas/common'

const profileSchema = z.object({
  fullName: requiredText('الاسم الكامل مطلوب', 2, 120),
  email: optionalText(120).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'بريد إلكتروني غير صالح'),
  phone: optionalText(30),
})

/** تعديل بياناتي (الاسم والبريد والهاتف). */
export async function updateProfileAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext()
    const data = profileSchema.parse(input)
    await transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId! }, select: { fullName: true, email: true, phone: true, username: true } })
      await tx.user.update({ where: { id: ctx.userId! }, data })
      await audit(tx, ctx, { action: 'update', entityType: 'User', entityId: ctx.userId!, entityLabel: before.username, summary: 'تعديل البيانات الشخصية', before, after: { ...data, username: before.username } })
    })
    return ok(null, 'تم حفظ بياناتك')
  } catch (e) {
    return toActionError(e)
  }
}

/** إنهاء جلساتي الأخرى (أجهزة أخرى)، أو جلسة محددة غير الحالية. */
export async function endMySessionsAction(sessionId: string | null): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext()
    const current = ctx.user.sessionId
    const target = typeof sessionId === 'string' && /^[a-f0-9]{64}$/.test(sessionId) && sessionId !== current ? sessionId : null
    const res = await db.session.deleteMany({ where: { userId: ctx.userId!, id: target ? target : { not: current } } })
    await audit(db, ctx, { action: 'sessions', entityType: 'User', entityId: ctx.userId!, entityLabel: ctx.user.username, summary: `إنهاء ${res.count} جلسة على أجهزة أخرى` })
    return ok(null, res.count ? 'تم إنهاء الجلسات على الأجهزة الأخرى' : 'لا توجد جلسات أخرى')
  } catch (e) {
    return toActionError(e)
  }
}
