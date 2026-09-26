import 'server-only'
import type { NextRequest } from 'next/server'

/**
 * حماية CSRF لمسارات POST خارج Server Actions: الطلب يجب أن يأتي من نفس الموقع
 * (ترويسة Origin أو Referer تطابق Host).
 */
export function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const origin = request.headers.get('origin') ?? request.headers.get('referer')
  if (!host || !origin) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
