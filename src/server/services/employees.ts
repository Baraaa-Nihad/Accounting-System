import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { EmployeeStatus, Gender, SalaryType } from '@/generated/prisma/enums'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { nextPlainNumber } from '../numbering'
import { accountIdByKey } from '../ledger/accounts'
import { partyBalance } from '../ledger/balances'
import { buildSearchText, cleanPhone, prepareSearchQuery } from '@/lib/arabic'
import { D, toDb } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'
import type Decimal from 'decimal.js'

/**
 * الموظفون والمعلمات (docs/05-workflows.md §5.19)
 */

export interface EmployeeInput {
  fullName: string
  phone?: string | null
  jobTitle?: string | null
  department?: string | null
  isTeacher?: boolean
  gender?: Gender | null
  nationalId?: string | null
  hireDate?: DateOnly | null
  salaryType: SalaryType
  baseSalary: string
  overtimeRate?: string | null
  bankName?: string | null
  bankAccount?: string | null
  iban?: string | null
  address?: string | null
  notes?: string | null
  importBatchId?: number | null
}

function employeeData(input: EmployeeInput) {
  const fullName = input.fullName.trim()
  if (fullName.length < 3) throw new BusinessError('اسم الموظف مطلوب', { fullName: 'مطلوب' })
  const base = D(input.baseSalary)
  if (base.isNegative()) throw new BusinessError('الراتب لا يمكن أن يكون سالبًا', { baseSalary: 'قيمة غير صالحة' })
  return {
    fullName,
    phone: cleanPhone(input.phone),
    jobTitle: input.jobTitle ?? null,
    department: input.department ?? null,
    isTeacher: !!input.isTeacher,
    gender: input.gender ?? null,
    nationalId: input.nationalId ?? null,
    hireDate: input.hireDate ? fromDateOnly(input.hireDate) : null,
    salaryType: input.salaryType,
    baseSalary: toDb(base),
    overtimeRate: input.overtimeRate ? toDb(input.overtimeRate) : null,
    bankName: input.bankName ?? null,
    bankAccount: input.bankAccount ?? null,
    iban: input.iban ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
  }
}

function searchTextOf(e: { fullName: string; employeeNumber: string; phone: string | null; jobTitle: string | null; department: string | null; nationalId: string | null }) {
  return buildSearchText([e.fullName, e.employeeNumber, e.phone, e.jobTitle, e.department, e.nationalId])
}

export async function createEmployee(tx: Tx, ctx: Ctx, input: EmployeeInput) {
  const data = employeeData(input)
  const employeeNumber = await nextPlainNumber(tx, 'employee', async (n) => !!(await tx.employee.findUnique({ where: { employeeNumber: n } })))
  const created = await tx.employee.create({
    data: { ...data, employeeNumber, importBatchId: input.importBatchId ?? null, searchText: searchTextOf({ ...data, employeeNumber }) },
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Employee',
    entityId: created.id,
    entityLabel: `${created.fullName} (${created.employeeNumber})`,
    summary: `إضافة موظف: ${created.fullName}${created.jobTitle ? ` — ${created.jobTitle}` : ''}`,
    after: created,
  })
  return created
}

export async function updateEmployee(tx: Tx, ctx: Ctx, id: number, input: EmployeeInput) {
  const before = await tx.employee.findUnique({ where: { id } })
  if (!before) throw new BusinessError('الموظف غير موجود')
  const data = employeeData(input)
  const after = await tx.employee.update({ where: { id }, data: { ...data, searchText: searchTextOf({ ...data, employeeNumber: before.employeeNumber }) } })
  const salaryChanged = !D(before.baseSalary).equals(D(after.baseSalary)) || before.salaryType !== after.salaryType
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'Employee',
    entityId: id,
    entityLabel: `${after.fullName} (${after.employeeNumber})`,
    summary: salaryChanged ? `تعديل بيانات الموظف ${after.fullName} (تغيير الراتب من ${before.baseSalary.toString()} إلى ${after.baseSalary.toString()})` : undefined,
    before,
    after,
  })
  return after
}

export async function setEmployeeStatus(tx: Tx, ctx: Ctx, id: number, input: { status: EmployeeStatus; endDate?: DateOnly | null; reason?: string | null }) {
  const before = await tx.employee.findUnique({ where: { id } })
  if (!before) throw new BusinessError('الموظف غير موجود')
  const after = await tx.employee.update({
    where: { id },
    data: { status: input.status, endDate: input.status === 'INACTIVE' ? (input.endDate ? fromDateOnly(input.endDate) : new Date()) : null },
  })
  await audit(tx, ctx, {
    action: 'status',
    entityType: 'Employee',
    entityId: id,
    entityLabel: after.fullName,
    summary: `${input.status === 'INACTIVE' ? 'إيقاف' : 'إعادة تفعيل'} الموظف ${after.fullName}${input.reason ? ` — ${input.reason}` : ''}`,
    before: { status: before.status, endDate: before.endDate },
    after: { status: after.status, endDate: after.endDate },
  })
  return after
}

export interface EmployeeFilters {
  q?: string
  status?: string
  kind?: string
  department?: string
  page?: number
  pageSize?: number
}

export async function listEmployees(client: DbOrTx, f: EmployeeFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const and: Prisma.EmployeeWhereInput[] = []
  if (f.q) {
    const { text, digits } = prepareSearchQuery(f.q)
    if (text) and.push({ OR: [{ searchText: { contains: text } }, ...(digits.length >= 3 ? [{ searchText: { contains: digits } }] : [])] })
  }
  if (f.status === 'ACTIVE' || f.status === 'INACTIVE') and.push({ status: f.status })
  if (f.kind === 'teacher') and.push({ isTeacher: true })
  if (f.kind === 'staff') and.push({ isTeacher: false })
  if (f.department) and.push({ department: f.department })
  const where = and.length ? { AND: and } : {}
  const [rows, total] = await Promise.all([
    client.employee.findMany({ where, orderBy: [{ status: 'asc' }, { fullName: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    client.employee.count({ where }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

/** ملخص الموظف المالي: المستحق له من الرواتب، السلف القائمة، المصروف له هذه السنة. */
export async function employeeSummary(client: DbOrTx, employeeId: number, range?: { from?: DateOnly; to?: DateOnly }) {
  const [payable, advancesAcc] = await Promise.all([accountIdByKey(client, 'SALARIES_PAYABLE'), accountIdByKey(client, 'EMPLOYEE_ADVANCES')])
  const [due, adv, paid] = await Promise.all([
    partyBalance(client, payable, { employeeId }),
    partyBalance(client, advancesAcc, { employeeId }),
    client.paymentVoucher.aggregate({
      where: {
        employeeId,
        kind: 'SALARY',
        status: 'ACTIVE',
        ...(range?.from || range?.to ? { date: { ...(range.from ? { gte: fromDateOnly(range.from) } : {}), ...(range.to ? { lte: fromDateOnly(range.to) } : {}) } } : {}),
      },
      _sum: { amount: true },
    }),
  ])
  return {
    salaryDue: due.credit.minus(due.debit).toString(),
    advancesOutstanding: adv.debit.minus(adv.credit).toString(),
    salariesPaid: D(paid._sum.amount).toString(),
  }
}

export async function departments(client: DbOrTx): Promise<string[]> {
  const rows = await client.employee.findMany({ where: { department: { not: null } }, distinct: ['department'], select: { department: true }, orderBy: { department: 'asc' } })
  return rows.map((r) => r.department!).filter(Boolean)
}

// ---------------------------------------------------------------------
// أجر الساعة/اليوم
// ---------------------------------------------------------------------

/** الأجر اليومي وأجر الساعة المشتقان من نوع الراتب (يستخدمان للغياب والتأخير والإضافي الافتراضي). */
export function derivedRates(salaryType: SalaryType, baseSalary: Decimal.Value, cfg: { workDaysPerMonth: number; hoursPerDay: number }) {
  const base = D(baseSalary)
  const days = D(cfg.workDaysPerMonth)
  const hours = D(cfg.hoursPerDay)
  switch (salaryType) {
    case 'MONTHLY':
      return { daily: base.dividedBy(days), hourly: base.dividedBy(days.times(hours)) }
    case 'DAILY':
      return { daily: base, hourly: base.dividedBy(hours) }
    case 'HOURLY':
      return { daily: base.times(hours), hourly: base }
  }
}
