import { NextResponse } from 'next/server'
import { routeCtx } from '@/server/import/route-ctx'
import { getImportType } from '@/server/import/registry'
import { buildTemplate } from '@/server/import/templates'
import { fileResponseHeaders } from '@/server/export/excel'

/** قالب Excel الجاهز لنوع الاستيراد (أعمدة عربية + قوائم + تعليمات). */
export async function GET(_request: Request, ctx: RouteContext<'/api/import/template/[type]'>) {
  const c = await routeCtx()
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { type } = await ctx.params
  const def = getImportType(type)
  if (!def) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!c.permissions.has('import.excel') || !def.permissions.some((p) => c.permissions.has(p))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const body = await buildTemplate(def)
  return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`قالب استيراد ${def.label}`, 'xlsx') })
}
