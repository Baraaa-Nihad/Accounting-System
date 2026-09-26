import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { globalSearch } from '@/server/services/search'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  const results = await globalSearch(q, user.permissions)
  return NextResponse.json({ results })
}
