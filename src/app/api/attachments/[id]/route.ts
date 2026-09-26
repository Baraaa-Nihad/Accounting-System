import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { readAttachment } from '@/server/services/attachments'
import { requestMeta } from '@/server/auth/session'

export async function GET(request: NextRequest, ctx: RouteContext<'/api/attachments/[id]'>) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  try {
    const meta = await requestMeta()
    const { att, data } = await readAttachment(
      { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: user.permissions },
      Number(id),
    )
    const download = request.nextUrl.searchParams.get('download') === '1'
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': att.mimeType,
        'Content-Length': String(data.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(att.originalName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
