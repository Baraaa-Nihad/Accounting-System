import 'server-only'
import { db, type DbOrTx } from '../db'
import { nameKey } from '@/lib/import-normalize'
import { toLatinDigits } from '@/lib/arabic'
import { toDateOnly, type DateOnly } from '@/lib/dates'

/**
 * البيانات المرجعية للتحقق من صفوف الاستيراد (تُحمّل مرة واحدة لكل تحقق):
 * الصفوف والشعب، أنواع الذمم، الطلاب، الصناديق، تصنيفات المصروفات، الموردون، الموظفون، السنوات.
 */

export interface LGrade {
  id: number
  name: string
  key: string
  sortOrder: number
  sections: { id: number; name: string; key: string }[]
}

export interface LStudent {
  id: number
  fullName: string
  studentNumber: string
  schoolNumber: string | null
  key: string
  phones: string[]
}

export interface Lookups {
  grades: LGrade[]
  chargeTypes: { id: number; name: string; key: string; allowInstallments: boolean; systemKey: string | null; isActive: boolean }[]
  students: LStudent[]
  byStudentNumber: Map<string, LStudent>
  bySchoolNumber: Map<string, LStudent>
  byStudentName: Map<string, LStudent[]>
  cashAccounts: { id: number; name: string; key: string; type: string; isDefault: boolean; isActive: boolean; glAccountId: number }[]
  expenseAccounts: { id: number; name: string; key: string; code: string }[]
  suppliers: Map<string, { id: number; name: string }>
  employeesByNumber: Map<string, { id: number; fullName: string }>
  employeesByName: Map<string, { id: number; fullName: string; phone: string | null }[]>
  years: { id: number; name: string; startDate: DateOnly; endDate: DateOnly; status: string }[]
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export async function loadLookups(client: DbOrTx = db): Promise<Lookups> {
  const [grades, chargeTypes, students, cash, expenses, suppliers, employees, years] = await Promise.all([
    client.grade.findMany({ include: { sections: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    client.chargeType.findMany({ orderBy: { sortOrder: 'asc' } }),
    client.student.findMany({ select: { id: true, fullName: true, studentNumber: true, schoolNumber: true, guardian: { select: { phone: true, phone2: true } } } }),
    client.cashAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    client.account.findMany({ where: { type: 'EXPENSE', isGroup: false, isActive: true }, orderBy: { code: 'asc' } }),
    client.supplier.findMany({ select: { id: true, name: true } }),
    client.employee.findMany({ select: { id: true, fullName: true, employeeNumber: true, phone: true } }),
    client.academicYear.findMany({ orderBy: { startDate: 'asc' } }),
  ])
  const ls: LStudent[] = students.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    studentNumber: s.studentNumber,
    schoolNumber: s.schoolNumber,
    key: nameKey(s.fullName),
    phones: [digits(s.guardian?.phone), digits(s.guardian?.phone2)].filter((p) => p.length >= 7).map((p) => p.slice(-9)),
  }))
  const byName = new Map<string, LStudent[]>()
  for (const s of ls) byName.set(s.key, [...(byName.get(s.key) ?? []), s])
  const empByName = new Map<string, { id: number; fullName: string; phone: string | null }[]>()
  for (const e of employees) {
    const k = nameKey(e.fullName)
    empByName.set(k, [...(empByName.get(k) ?? []), { id: e.id, fullName: e.fullName, phone: e.phone }])
  }
  return {
    grades: grades.map((g) => ({
      id: g.id,
      name: g.name,
      key: nameKey(g.name),
      sortOrder: g.sortOrder,
      sections: g.sections.map((s) => ({ id: s.id, name: s.name, key: nameKey(s.name) })),
    })),
    chargeTypes: chargeTypes.map((t) => ({ id: t.id, name: t.name, key: nameKey(t.name), allowInstallments: t.allowInstallments, systemKey: t.systemKey, isActive: t.isActive })),
    students: ls,
    byStudentNumber: new Map(ls.map((s) => [s.studentNumber, s])),
    bySchoolNumber: new Map(ls.filter((s) => s.schoolNumber).map((s) => [s.schoolNumber!, s])),
    byStudentName: byName,
    cashAccounts: cash.map((c) => ({ id: c.id, name: c.name, key: nameKey(c.name), type: c.type, isDefault: c.isDefault, isActive: c.isActive, glAccountId: c.glAccountId })),
    expenseAccounts: expenses.map((a) => ({ id: a.id, name: a.name, key: nameKey(a.name), code: a.code })),
    suppliers: new Map(suppliers.map((s) => [nameKey(s.name), s])),
    employeesByNumber: new Map(employees.map((e) => [e.employeeNumber, { id: e.id, fullName: e.fullName }])),
    employeesByName: empByName,
    years: years.map((y) => ({ id: y.id, name: y.name, startDate: toDateOnly(y.startDate), endDate: toDateOnly(y.endDate), status: y.status })),
  }
}

const ORDINALS = ['اول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن', 'تاسع', 'عاشر', 'حادي عشر', 'ثاني عشر']

/** مطابقة الصف: «الصف الخامس» / «خامس» / «5» / «Grade 5». */
export function matchGrade(l: Lookups, value: string): LGrade | null {
  const k = nameKey(value)
  const exact = l.grades.find((g) => g.key === k)
  if (exact) return exact
  const stripped = k.replace(/^(الصف|صف|grade|class)\s*/, '').replace(/^ال/, '').trim()
  const num = Number(toLatinDigits(stripped))
  const word = Number.isInteger(num) && num >= 1 && num <= 12 ? ORDINALS[num - 1] : stripped
  const candidates = l.grades.filter((g) => {
    const gk = g.key.replace(/^(الصف|صف)\s*/, '').replace(/^ال/, '').trim()
    return gk === word || gk === `ال${word}` || g.key === `الصف ال${word}`
  })
  if (candidates.length === 1) return candidates[0]
  const contains = l.grades.filter((g) => g.key.includes(stripped) && stripped.length >= 3)
  return contains.length === 1 ? contains[0] : null
}

/** إيجاد الطالب برقم الطالب أو الرقم المدرسي أو الاسم (يجب أن يكون الاسم فريدًا). */
export function findStudent(l: Lookups, value: string): { student: LStudent } | { error: string } {
  const v = toLatinDigits(value).trim()
  const byNum = l.byStudentNumber.get(v)
  if (byNum) return { student: byNum }
  const bySchool = l.bySchoolNumber.get(v)
  if (bySchool) return { student: bySchool }
  const byName = l.byStudentName.get(nameKey(value)) ?? []
  if (byName.length === 1) return { student: byName[0] }
  if (byName.length > 1) return { error: `يوجد ${byName.length} طلاب بنفس الاسم «${value}» — استخدم رقم الطالب` }
  return { error: `الطالب «${value}» غير موجود` }
}

export function findChargeType(l: Lookups, value: string) {
  const k = nameKey(value)
  return l.chargeTypes.find((t) => t.key === k) ?? null
}

export function findExpenseAccount(l: Lookups, value: string) {
  const k = nameKey(value)
  return l.expenseAccounts.find((a) => a.key === k || a.code === value.trim()) ?? null
}

export function findCashAccount(l: Lookups, value: string | null, fallbackId: number | null) {
  if (value) {
    const k = nameKey(value)
    const found = l.cashAccounts.find((c) => c.key === k && c.isActive)
    return found ?? null
  }
  if (fallbackId) return l.cashAccounts.find((c) => c.id === fallbackId && c.isActive) ?? null
  return l.cashAccounts.find((c) => c.isDefault && c.isActive) ?? l.cashAccounts.find((c) => c.isActive) ?? null
}

/** السنة المفتوحة التي يقع فيها التاريخ. */
export function openYearFor(l: Lookups, date: DateOnly) {
  return l.years.find((y) => y.startDate <= date && date <= y.endDate && y.status === 'OPEN') ?? null
}
