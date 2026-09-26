import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { listStudents } from '@/server/services/students'
import { getSelectedYear } from '@/server/context-year'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !user.permissions.has('students.view')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  const guardianId = Number(request.nextUrl.searchParams.get('guardianId')) || undefined
  const year = await getSelectedYear()
  // كل الطلاب، مع صفهم في السنة المختارة إن وُجد
  const { rows } = await listStudents({ q, guardianId, yearId: year?.id ?? null, onlyEnrolled: false, pageSize: 12 })
  return NextResponse.json({
    results: rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      studentNumber: r.studentNumber,
      status: r.status,
      guardianName: r.guardianName,
      guardianPhone: r.guardianPhone,
      gradeName: r.gradeName,
      sectionName: r.sectionName,
      remaining: r.remaining,
      credit: r.credit,
    })),
  })
}
