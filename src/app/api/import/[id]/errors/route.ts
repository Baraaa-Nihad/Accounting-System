import { NextResponse, type NextRequest } from 'next/server'
import { routeCtx } from '@/server/import/route-ctx'
import { errorReport, loadSession } from '@/server/import/service'
import { fileResponseHeaders } from '@/server/export/excel'
import { BusinessError } from '@/server/errors'

/** تقرير نتيجة التحقق: الصفوف المرفوضة والمكررة مع رسائلها وبياناتها الأصلية لتصحيحها وإعادة رفعها. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/import/[id]/errors'>) {
  const c = await routeCtx()
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'not found' }, { status: 404 })
  try {
    const s = await loadSession(c, id)
    const all = request.nextUrl.searchParams.get('all') === '1'
    const body = await errorReport(c, id, !all)
    return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`${all ? 'نتيجة التحقق' : 'أخطاء استيراد'} ${s.def.label}`, 'xlsx') })
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 403 })
    throw e
  }
}
