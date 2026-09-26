import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { effectivePermissions, type Permission } from '@/lib/permissions'
import { getSetting } from '../settings'
import type { Ctx } from '../context'
import { BusinessError, PermissionError } from '../errors'
import { readSessionToken, requestMeta, validateSession } from './session'

export interface CurrentUser {
  id: number
  username: string
  fullName: string
  roleKey: string | null
  roleName: string
  permissions: Set<Permission>
  mustChangePassword: boolean
  sessionId: string
}

/** المستخدم الحالي من جلسته (مرة واحدة لكل طلب). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionToken()
  if (!token) return null
  const { sessionHours } = await getSetting('security')
  const session = await validateSession(token, sessionHours)
  if (!session) return null
  const u = session.user
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    roleKey: u.role.key,
    roleName: u.role.name,
    permissions: effectivePermissions({
      roleKey: u.role.key,
      rolePermissions: u.role.permissions,
      extraPermissions: u.extraPermissions,
      revokedPermissions: u.revokedPermissions,
    }),
    mustChangePassword: u.mustChangePassword,
    sessionId: session.id,
  }
})

export function can(user: CurrentUser | null | undefined, permission: Permission): boolean {
  return !!user && user.permissions.has(permission)
}

export function canAny(user: CurrentUser | null | undefined, permissions: Permission[]): boolean {
  return !!user && permissions.some((p) => user.permissions.has(p))
}

/** للصفحات: يعيد التوجيه لصفحة الدخول إن لم تكن هناك جلسة. */
export async function requireUser(options?: { allowPasswordChange?: boolean }): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.mustChangePassword && !options?.allowPasswordChange) redirect('/change-password')
  return user
}

/** للصفحات: يتطلب صلاحية واحدة على الأقل من المذكورة. */
export async function requirePermission(...permissions: Permission[]): Promise<CurrentUser> {
  const user = await requireUser()
  if (!permissions.some((p) => user.permissions.has(p))) redirect('/forbidden')
  return user
}

/**
 * لإجراءات الخادم (Server Actions): يتحقق من الجلسة والصلاحية ويعيد سياق التنفيذ.
 * يرمي خطأ عمل برسالة عربية بدلًا من إعادة التوجيه.
 */
export async function actionContext(...permissions: Permission[]): Promise<Ctx & { user: CurrentUser }> {
  const user = await getCurrentUser()
  if (!user) throw new BusinessError('انتهت الجلسة، يرجى تسجيل الدخول من جديد')
  if (user.mustChangePassword) throw new BusinessError('يجب تغيير كلمة المرور أولًا')
  if (permissions.length > 0 && !permissions.some((p) => user.permissions.has(p))) throw new PermissionError()
  const meta = await requestMeta()
  return {
    user,
    userId: user.id,
    userName: user.fullName,
    ip: meta.ip,
    userAgent: meta.userAgent,
    permissions: user.permissions,
  }
}

export function assertCan(ctx: Ctx, permission: Permission, message?: string) {
  if (!ctx.permissions.has(permission)) throw new PermissionError(message)
}

/** الاطلاع على مبالغ الرواتب: صلاحية «الاطلاع على الرواتب» أو إدارة/صرف الرواتب. */
export function canSeeSalaries(user: CurrentUser | null | undefined): boolean {
  return canAny(user, ['salaries.view', 'payroll.manage', 'payroll.pay'])
}
