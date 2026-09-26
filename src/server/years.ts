import 'server-only'
import type { DbOrTx } from './db'
import { db } from './db'
import { BusinessError } from './errors'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import { today } from './settings'

export async function findYearForDate(client: DbOrTx, date: DateOnly) {
  const d = fromDateOnly(date)
  return client.academicYear.findFirst({
    where: { startDate: { lte: d }, endDate: { gte: d } },
    orderBy: { startDate: 'desc' },
  })
}

/**
 * السنة المالية التي يقع فيها التاريخ، مع قفل السنوات المغلقة.
 * أي حركة مالية بتاريخ داخل سنة مغلقة تُرفض.
 */
export async function resolveOpenYear(client: DbOrTx, date: DateOnly, options?: { allowClosed?: boolean }) {
  const year = await findYearForDate(client, date)
  if (!year) {
    throw new BusinessError(
      `التاريخ ${date} لا يقع ضمن أي سنة دراسية معرّفة. أضف السنة الدراسية من الإعدادات ← السنوات الدراسية.`,
    )
  }
  if (year.status === 'CLOSED' && !options?.allowClosed) {
    throw new BusinessError(`السنة الدراسية ${year.name} مغلقة، ولا يمكن تسجيل أو تعديل حركات بتاريخ داخلها.`)
  }
  return year
}

export async function assertYearOpen(client: DbOrTx, academicYearId: number) {
  const year = await client.academicYear.findUnique({ where: { id: academicYearId } })
  if (!year) throw new BusinessError('السنة الدراسية غير موجودة')
  if (year.status === 'CLOSED') throw new BusinessError(`السنة الدراسية ${year.name} مغلقة`)
  return year
}

/** السنة الحالية: المعلّمة «حالية»، أو التي يقع فيها تاريخ اليوم، أو آخر سنة. */
export async function getCurrentYear(client: DbOrTx = db) {
  const current = await client.academicYear.findFirst({ where: { isCurrent: true } })
  if (current) return current
  const byDate = await findYearForDate(client, await today(client))
  if (byDate) return byDate
  return client.academicYear.findFirst({ orderBy: { startDate: 'desc' } })
}

export async function listYears(client: DbOrTx = db) {
  const years = await client.academicYear.findMany({ orderBy: { startDate: 'desc' } })
  return years.map((y) => ({
    id: y.id,
    name: y.name,
    startDate: toDateOnly(y.startDate),
    endDate: toDateOnly(y.endDate),
    status: y.status,
    isCurrent: y.isCurrent,
  }))
}
