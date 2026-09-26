import 'server-only'
import { db } from '../db'
import type { FilterControl } from '@/components/reports/report-filter-bar'
import type { PickedStudent } from '@/components/forms/student-picker'
import type { PeriodKey } from '@/lib/period'
import type { FilterKey, ReportDef, ReportFilters } from './types'

const LABELS: Record<FilterKey, string> = {
  period: 'الفترة',
  year: 'السنة الدراسية',
  student: 'الطالب',
  grade: 'الصف',
  kind: 'النوع',
  method: 'طريقة الدفع',
  user: 'المستخدم',
  amount: 'المبلغ',
  chargeType: 'نوع الذمة',
  account: 'الحساب',
  employee: 'الموظف',
  supplier: 'المورد',
  status: 'الحالة',
  category: 'التصنيف',
  q: 'بحث',
}

/** تجهيز عناصر شريط الفلاتر مع خياراتها وقيمها الحالية. */
export async function buildFilterControls(def: ReportDef, f: ReportFilters) {
  const controls: FilterControl[] = []
  const current: Record<string, string> = {}
  let period: { key: PeriodKey; from: string | null; to: string | null; defaultKey: PeriodKey } | null = null
  let student: PickedStudent | null = null

  for (const spec of def.filters) {
    const label = spec.label ?? LABELS[spec.key]
    switch (spec.key) {
      case 'period':
        period = { key: f.periodKey, from: f.from, to: f.to, defaultKey: spec.defaultPeriod ?? 'year' }
        break
      case 'year': {
        const years = await db.academicYear.findMany({ orderBy: { startDate: 'desc' } })
        controls.push({ key: 'year', label, options: years.map((y) => ({ value: String(y.id), label: y.name })), allowAllYears: spec.allowAllYears })
        current.year = f.yearId ? String(f.yearId) : 'all'
        break
      }
      case 'student': {
        controls.push({ key: 'student', label })
        if (f.studentId) {
          const s = await db.student.findUnique({ where: { id: f.studentId } })
          if (s) student = { id: s.id, fullName: s.fullName, studentNumber: s.studentNumber }
        }
        break
      }
      case 'grade': {
        const grades = await db.grade.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
        controls.push({ key: 'grade', label, options: grades.map((g) => ({ value: String(g.id), label: g.name })) })
        if (f.gradeId) current.grade = String(f.gradeId)
        break
      }
      case 'chargeType': {
        const types = await db.chargeType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
        controls.push({ key: 'chargeType', label, options: types.map((t) => ({ value: String(t.id), label: t.name })) })
        if (f.chargeTypeId) current.chargeType = String(f.chargeTypeId)
        break
      }
      case 'user': {
        const users = await db.user.findMany({ orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } })
        controls.push({ key: 'user', label, options: users.map((u) => ({ value: String(u.id), label: u.fullName })) })
        if (f.userId) current.user = String(f.userId)
        break
      }
      case 'account': {
        const accounts = await db.cashAccount.findMany({ where: spec.accountType ? { type: spec.accountType } : {}, orderBy: [{ type: 'asc' }, { name: 'asc' }] })
        controls.push({ key: 'account', label, options: accounts.map((a) => ({ value: String(a.id), label: a.name })), allLabel: spec.accountType ? 'كل الحسابات (ملخص)' : undefined })
        if (f.accountId) current.account = String(f.accountId)
        break
      }
      case 'employee': {
        const employees = await db.employee.findMany({ orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } })
        controls.push({ key: 'employee', label, options: employees.map((e) => ({ value: String(e.id), label: e.fullName })) })
        if (f.employeeId) current.employee = String(f.employeeId)
        break
      }
      case 'supplier': {
        const suppliers = await db.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
        controls.push({ key: 'supplier', label, options: suppliers.map((s) => ({ value: String(s.id), label: s.name })) })
        if (f.supplierId) current.supplier = String(f.supplierId)
        break
      }
      case 'method':
        controls.push({ key: 'method', label })
        if (f.method) current.method = f.method
        break
      case 'kind':
      case 'status':
      case 'category': {
        const options = spec.options ?? (spec.loadOptions ? await spec.loadOptions() : [])
        const explicitAll = !!spec.defaultValue
        controls.push({ key: spec.key, label, options, allLabel: spec.allLabel, explicitAll })
        const value = spec.key === 'kind' ? f.kind : spec.key === 'status' ? f.status : f.categoryId ? String(f.categoryId) : null
        current[spec.key] = value ?? (explicitAll ? 'all' : '')
        break
      }
      case 'amount':
        controls.push({ key: 'amount', label })
        if (f.min) current.min = f.min
        if (f.max) current.max = f.max
        break
      case 'q':
        controls.push({ key: 'q', label })
        if (f.q) current.q = f.q
        break
    }
  }
  return { controls, current, period, student }
}
