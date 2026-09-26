'use server'

import { cookies } from 'next/headers'
import { YEAR_COOKIE } from '@/server/context-year'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'

export async function selectYearAction(yearId: number) {
  const user = await getCurrentUser()
  if (!user) return
  const year = await db.academicYear.findUnique({ where: { id: yearId } })
  if (!year) return
  const jar = await cookies()
  jar.set(YEAR_COOKIE, String(year.id), { httpOnly: true, sameSite: 'lax', path: '/' })
}
