import 'server-only'
import { cookies } from 'next/headers'
import { db } from './db'
import { getCurrentYear } from './years'

export const YEAR_COOKIE = 'sa_year'

/** السنة المختارة في شريط الأعلى (تُستخدم كفلتر افتراضي)، أو السنة الحالية. */
export async function getSelectedYear() {
  const jar = await cookies()
  const id = Number(jar.get(YEAR_COOKIE)?.value)
  if (Number.isInteger(id) && id > 0) {
    const y = await db.academicYear.findUnique({ where: { id } })
    if (y) return y
  }
  return getCurrentYear()
}
