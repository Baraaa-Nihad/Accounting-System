import 'server-only'
import { db } from '../db'
import { resolvePeriod, type PeriodKey } from '@/lib/period'
import { toDateOnly, type DateOnly } from '@/lib/dates'
import { parseAmountInput } from '@/lib/money'
import { PAYMENT_METHOD } from '@/lib/labels'
import type { ReportDef, ReportFilters } from './types'

type SP = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const int = (v: string | string[] | undefined) => {
  const n = Number(first(v))
  return Number.isInteger(n) && n > 0 ? n : null
}
const amt = (v: string | string[] | undefined) => {
  const s = first(v)
  if (!s) return null
  const d = parseAmountInput(s)
  return d && !d.isNegative() ? d.toString() : null
}

/** قراءة فلاتر التقرير من الرابط مع القيم الافتراضية لكل تقرير. */
export async function parseReportFilters(
  def: ReportDef,
  sp: SP,
  ctx: { today: DateOnly; weekStartDay: number; selected: { id: number; startDate: Date; endDate: Date } | null },
): Promise<ReportFilters> {
  const { today, weekStartDay, selected } = ctx
  const has = (k: string) => def.filters.some((f) => f.key === k)
  const spec = (k: string) => def.filters.find((f) => f.key === k)

  // السنة: المختارة في الشريط العلوي افتراضيًا، أو «كل السنوات» إن سُمح
  let yearId: number | null = null
  if (has('year')) {
    const raw = first(sp.year)
    if ((raw === 'all' || (!raw && spec('year')?.defaultAll)) && spec('year')?.allowAllYears) yearId = null
    else yearId = int(sp.year) ?? selected?.id ?? null
  }

  // الفترة: من/إلى أو قالب؛ «السنة» تعني تواريخ السنة المختارة في الفلتر
  let periodKey: PeriodKey = 'all'
  let from: DateOnly | null = null
  let to: DateOnly | null = null
  if (has('period')) {
    let yearRange: { startDate: DateOnly; endDate: DateOnly } | null = null
    const y = yearId ? await db.academicYear.findUnique({ where: { id: yearId } }) : selected
    if (y) yearRange = { startDate: toDateOnly(y.startDate), endDate: toDateOnly(y.endDate) }
    const p = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) }, { today, year: yearRange, weekStartDay }, spec('period')?.defaultPeriod ?? 'year')
    periodKey = p.key
    from = p.from
    to = p.to
  }

  const opt = (k: 'kind' | 'status') => {
    const v = first(sp[k])
    const s = spec(k)
    if (!s) return null
    if (v === 'all') return null
    if (v && (!s.options || s.options.some((o) => o.value === v))) return v
    return s.defaultValue ?? null
  }

  return {
    periodKey,
    from,
    to,
    yearId,
    studentId: has('student') ? int(sp.student) : null,
    gradeId: has('grade') ? int(sp.grade) : null,
    kind: opt('kind'),
    method: has('method') ? (first(sp.method) ?? null) : null,
    userId: has('user') ? int(sp.user) : null,
    min: has('amount') ? amt(sp.min) : null,
    max: has('amount') ? amt(sp.max) : null,
    chargeTypeId: has('chargeType') ? int(sp.chargeType) : null,
    accountId: has('account') ? int(sp.account) : null,
    employeeId: has('employee') ? int(sp.employee) : null,
    supplierId: has('supplier') ? int(sp.supplier) : null,
    status: opt('status'),
    categoryId: has('category') ? int(sp.category) : null,
    q: has('q') ? (first(sp.q)?.trim() || null) : null,
  }
}

/** وصف الفلاتر المطبقة نصًا (لرأس الملف المصدَّر والطباعة). */
export async function describeFilters(def: ReportDef, f: ReportFilters): Promise<string[]> {
  const out: string[] = []
  if (f.from || f.to) out.push(`الفترة: ${f.from ?? '...'} ← ${f.to ?? '...'}`)
  if (def.filters.some((x) => x.key === 'year')) {
    const y = f.yearId ? await db.academicYear.findUnique({ where: { id: f.yearId } }) : null
    out.push(`السنة الدراسية: ${y?.name ?? 'كل السنوات'}`)
  }
  if (f.gradeId) out.push(`الصف: ${(await db.grade.findUnique({ where: { id: f.gradeId } }))?.name ?? ''}`)
  if (f.studentId) out.push(`الطالب: ${(await db.student.findUnique({ where: { id: f.studentId } }))?.fullName ?? ''}`)
  if (f.chargeTypeId) out.push(`نوع الذمة: ${(await db.chargeType.findUnique({ where: { id: f.chargeTypeId } }))?.name ?? ''}`)
  if (f.accountId) out.push(`الحساب: ${(await db.cashAccount.findUnique({ where: { id: f.accountId } }))?.name ?? ''}`)
  if (f.employeeId) out.push(`الموظف: ${(await db.employee.findUnique({ where: { id: f.employeeId } }))?.fullName ?? ''}`)
  if (f.supplierId) out.push(`المورد: ${(await db.supplier.findUnique({ where: { id: f.supplierId } }))?.name ?? ''}`)
  if (f.userId) out.push(`المستخدم: ${(await db.user.findUnique({ where: { id: f.userId } }))?.fullName ?? ''}`)
  const kindSpec = def.filters.find((x) => x.key === 'kind')
  if (f.kind && kindSpec?.options) out.push(`${kindSpec.label ?? 'النوع'}: ${kindSpec.options.find((o) => o.value === f.kind)?.label ?? f.kind}`)
  const statusSpec = def.filters.find((x) => x.key === 'status')
  if (f.status && statusSpec?.options) out.push(`${statusSpec.label ?? 'الحالة'}: ${statusSpec.options.find((o) => o.value === f.status)?.label ?? f.status}`)
  if (f.method) out.push(`طريقة الدفع: ${PAYMENT_METHOD[f.method] ?? f.method}`)
  if (f.categoryId) out.push(`التصنيف: ${(await db.account.findUnique({ where: { id: f.categoryId } }))?.name ?? ''}`)
  if (f.min || f.max) out.push(`المبلغ: ${f.min ?? '0'} ← ${f.max ?? '...'}`)
  if (f.q) out.push(`بحث: ${f.q}`)
  return out
}
