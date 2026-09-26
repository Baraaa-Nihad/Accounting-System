import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { SESSION_COOKIE } from '@/server/auth/session'
import { renderPdf, pdfAvailable } from '@/server/pdf'

/** تحويل أي صفحة طباعة (/print/...) إلى ملف PDF للتنزيل. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/pdf/[...path]'>) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!pdfAvailable()) {
    return new NextResponse('توليد PDF على الخادم غير مفعل. استخدم زر «طباعة / حفظ PDF» في صفحة الطباعة.', {
      status: 501,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const { path } = await ctx.params
  if (!path.every((p) => /^[\w.-]+$/.test(p))) return NextResponse.json({ error: 'bad path' }, { status: 400 })
  const base = process.env.APP_INTERNAL_URL || request.nextUrl.origin
  const search = new URLSearchParams(request.nextUrl.search)
  search.delete('auto')
  const target = `${base}/print/${path.join('/')}${search.toString() ? `?${search}` : ''}`
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const pdf = await renderPdf(target, { name: SESSION_COOKIE, value: token })
    const name = `${path.join('-')}.pdf`
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[pdf]', e)
    return new NextResponse('تعذر توليد ملف PDF', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}
