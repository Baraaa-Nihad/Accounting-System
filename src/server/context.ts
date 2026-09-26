import type { Permission } from '@/lib/permissions'
import { ALL_PERMISSIONS } from '@/lib/permissions'

/** سياق تنفيذ العمليات: من ينفذ، ومن أي جهاز — يُمرر لكل خدمة لتسجيله في سجل النشاط. */
export interface Ctx {
  userId: number | null
  userName: string
  ip: string | null
  userAgent: string | null
  permissions: Set<Permission>
}

export function systemCtx(name = 'النظام'): Ctx {
  return { userId: null, userName: name, ip: null, userAgent: null, permissions: new Set(ALL_PERMISSIONS) }
}
