import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { findGuardianByPhone } from '@/server/services/guardians'
import { db } from '@/server/db'
import { prepareSearchQuery } from '@/lib/arabic'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !user.permissions.has('students.view')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const phone = request.nextUrl.searchParams.get('phone')
  if (phone) {
    const g = await findGuardianByPhone(db, phone)
    return NextResponse.json({ match: g ? { id: g.id, name: g.name, phone: g.phone, students: g.students } : null })
  }
  const { text, digits } = prepareSearchQuery(request.nextUrl.searchParams.get('q') ?? '')
  if (!text) return NextResponse.json({ results: [] })
  const results = await db.guardian.findMany({
    where: { OR: [{ searchText: { contains: text } }, ...(digits.length >= 3 ? [{ searchText: { contains: digits } }] : [])] },
    take: 10,
    include: { students: { select: { id: true, fullName: true }, take: 6 } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({
    results: results.map((g) => ({ id: g.id, name: g.name, phone: g.phone, students: g.students })),
  })
}
