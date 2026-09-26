import 'server-only'
import { getCurrentUser } from '../auth/guard'
import { requestMeta } from '../auth/session'
import type { Ctx } from '../context'

/** سياق التنفيذ لمسارات التنزيل (API routes) من جلسة المستخدم. */
export async function routeCtx(): Promise<Ctx | null> {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return null
  const meta = await requestMeta()
  return { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: user.permissions }
}
