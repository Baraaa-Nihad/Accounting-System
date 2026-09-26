'use server'

import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { createUser, deleteRole, endUserSessions, resetUserPassword, saveRole, unlockUser, updateUser } from '@/server/services/users'
import { createUserSchema, resetPasswordSchema, roleSchema, updateUserSchema } from '@/lib/schemas/users'
import { id as idSchema } from '@/lib/schemas/common'

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('users.manage')
    const data = createUserSchema.parse(input)
    const user = await transaction((tx) => createUser(tx, ctx, data))
    return ok({ id: user.id }, `تمت إضافة المستخدم ${user.username} — سيُطلب منه تغيير كلمة المرور عند أول دخول`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateUserAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('users.manage')
    const { id, ...data } = updateUserSchema.parse(input)
    await transaction((tx) => updateUser(tx, ctx, id, data))
    return ok(null, 'تم حفظ بيانات المستخدم وصلاحياته')
  } catch (e) {
    return toActionError(e)
  }
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('users.manage')
    const data = resetPasswordSchema.parse(input)
    await transaction((tx) => resetUserPassword(tx, ctx, data.id, data.password))
    return ok(null, 'تم تعيين كلمة المرور المؤقتة وإنهاء جلسات المستخدم')
  } catch (e) {
    return toActionError(e)
  }
}

export async function unlockUserAction(userId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('users.manage')
    await transaction((tx) => unlockUser(tx, ctx, idSchema.parse(userId)))
    return ok(null, 'تم فك قفل الحساب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function endUserSessionsAction(input: { userId: number; sessionId?: string | null }): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('users.manage')
    const userId = idSchema.parse(input.userId)
    const sessionId = typeof input.sessionId === 'string' && /^[a-f0-9]{64}$/.test(input.sessionId) ? input.sessionId : null
    const n = await transaction((tx) => endUserSessions(tx, ctx, userId, sessionId))
    return ok(null, n ? `تم إنهاء ${n === 1 ? 'الجلسة' : `${n} جلسات`}` : 'لا توجد جلسات نشطة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function saveRoleAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('users.manage')
    const data = roleSchema.parse(input)
    const role = await transaction((tx) => saveRole(tx, ctx, { id: data.id ?? null, name: data.name, description: data.description, permissions: data.permissions }))
    return ok({ id: role.id }, 'تم حفظ الدور — تسري الصلاحيات على مستخدميه فورًا')
  } catch (e) {
    return toActionError(e)
  }
}

export async function deleteRoleAction(roleId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('users.manage')
    await transaction((tx) => deleteRole(tx, ctx, idSchema.parse(roleId)))
    return ok(null, 'تم حذف الدور')
  } catch (e) {
    return toActionError(e)
  }
}
