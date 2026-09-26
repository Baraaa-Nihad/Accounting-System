import { NextResponse, type NextRequest } from 'next/server'

/**
 * طبقة الحماية الأولى لكل طلب:
 * - ترويسات الأمان وسياسة أمان المحتوى (CSP) مع nonce لكل طلب
 * - توجيه غير المسجلين لصفحة الدخول (التحقق الكامل من الجلسة يتم في الصفحات والإجراءات)
 */

const SESSION_COOKIE = 'sa_session'
const PUBLIC_PATHS = ['/login', '/api/health', '/api/logo', '/api/backups/run']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value

  if (!isPublic && !hasSession) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // المسار الحالي لتسجيل محاولات الوصول المرفوضة في سجل النشاط
  requestHeaders.set('x-pathname', `${pathname}${request.nextUrl.search}`.slice(0, 300))
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  return response
}

export const config = {
  matcher: [
    {
      // رفع النسخ الاحتياطية يتدفق مباشرة دون المرور بالـ proxy (قد يتجاوز حجمه حد التخزين المؤقت)؛ المسار يتحقق من الجلسة بنفسه
      source: '/((?!_next/static|_next/image|favicon.ico|api/backups/upload).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
