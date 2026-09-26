import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { resolveOpenYear } from '../years'
import { postEntry, reverseEntry, type JournalLineInput } from '../ledger/posting'
import { accountIdByKey } from '../ledger/accounts'
import { derivedRates } from './employees'
import { calcPayrollItem } from '@/lib/payroll-calc'
import { D, min, round, sum, toDb } from '@/lib/money'
import { endOfMonth, fromDateOnly, makeDate, parts, toDateOnly, type DateOnly } from '@/lib/dates'
import type Decimal from 'decimal.js'

/**
 * مسيرات الرواتب (docs/05-workflows.md §5.17 – §5.19، docs/08-edge-cases.md §8.4)
 *
 * مسودة ← (إدخال الغياب والتأخير والمكافآت...) ← اعتماد بقيد محاسبي ← صرف بسندات صرف.
 * الساعات الإضافية وأقساط السلف تُربط ببند الموظف عند الاحتساب، وتصبح نهائية عند الاعتماد.
 */

export function monthEnd(year: number, month: number): DateOnly {
  return endOfMonth(makeDate(year, month, 1))
}

export function runLabel(run: { year: number; month: number }) {
  return `${run.month}/${run.year}`
}

// ---------------------------------------------------------------------
// المدفوع والإجماليات
// ---------------------------------------------------------------------

/** إعادة حساب المدفوع من بند راتب من سندات الصرف الفعالة، وتحديث إجمالي المدفوع للمسير. */
export async function recomputePayrollItemPaid(tx: Tx, itemId: number) {
  const agg = await tx.paymentVoucher.aggregate({ where: { payrollItemId: itemId, status: 'ACTIVE' }, _sum: { amount: true } })
  const item = await tx.payrollItem.findUniqueOrThrow({ where: { id: itemId } })
  const paid = D(agg._sum.amount)
  const net = D(item.netPay)
  const paymentStatus = paid.isZero() ? 'UNPAID' : paid.greaterThanOrEqualTo(net) ? 'PAID' : 'PARTIAL'
  await tx.payrollItem.update({ where: { id: itemId }, data: { paidAmount: toDb(paid), paymentStatus } })
  await recomputeRunPaid(tx, item.payrollRunId)
}

export async function recomputeRunPaid(tx: Tx, runId: number) {
  const agg = await tx.payrollItem.aggregate({ where: { payrollRunId: runId }, _sum: { paidAmount: true } })
  await tx.payrollRun.update({ where: { id: runId }, data: { totalPaid: toDb(D(agg._sum.paidAmount)) } })
}

async function recomputeRunTotals(tx: Tx, runId: number) {
  const agg = await tx.payrollItem.aggregate({
    where: { payrollRunId: runId },
    _sum: { grossPay: true, totalDeductions: true, netPay: true, paidAmount: true },
  })
  await tx.payrollRun.update({
    where: { id: runId },
    data: {
      totalGross: toDb(D(agg._sum.grossPay)),
      totalDeductions: toDb(D(agg._sum.totalDeductions)),
      totalNet: toDb(D(agg._sum.netPay)),
      totalPaid: toDb(D(agg._sum.paidAmount)),
    },
  })
}

async function lockRun(tx: Tx, runId: number) {
  await tx.$queryRaw`SELECT "id" FROM "payroll_runs" WHERE "id" = ${runId} FOR UPDATE`
  const run = await tx.payrollRun.findUnique({ where: { id: runId } })
  if (!run) throw new BusinessError('مسير الرواتب غير موجود')
  return run
}

// ---------------------------------------------------------------------
// الاحتساب
// ---------------------------------------------------------------------

/** أقساط السلف المستحقة لموظف في شهر (الأقدم أولًا). */
async function planAdvances(tx: Tx, employeeId: number, year: number, month: number) {
  const advances = await tx.employeeAdvance.findMany({
    where: { employeeId, status: 'ACTIVE' },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })
  const key = year * 12 + month
  const plan: { advanceId: number; planned: Decimal }[] = []
  for (const a of advances) {
    if (a.startYear * 12 + a.startMonth > key) continue
    const remaining = D(a.amount).minus(D(a.deductedAmount))
    if (!remaining.greaterThan(0)) continue
    plan.push({ advanceId: a.id, planned: min(a.monthlyDeduction, remaining) })
  }
  return plan
}

/** أيام العمل الافتراضية (نسبية لمن عُيّن خلال الشهر). */
function defaultWork(emp: { salaryType: string; hireDate: Date | null }, year: number, month: number, cfg: { workDaysPerMonth: number; hoursPerDay: number }) {
  let days = cfg.workDaysPerMonth
  if (emp.hireDate) {
    const h = parts(toDateOnly(emp.hireDate))
    if (h.y === year && h.m === month && h.d > 1) days = Math.max(0, Math.min(cfg.workDaysPerMonth, cfg.workDaysPerMonth - h.d + 1))
  }
  return { workDays: days, workHours: emp.salaryType === 'HOURLY' ? days * cfg.hoursPerDay : 0 }
}

/**
 * إعادة احتساب بند في مسودة: ربط الإضافي المعلّق، تخطيط أقساط السلف، وحساب المبالغ.
 * refreshRate: تحديث نوع الراتب وقيمته من ملف الموظف (زر «إعادة الاحتساب»).
 */
export async function recalculateItem(tx: Tx, itemId: number, options?: { refreshRate?: boolean }) {
  const { finance, payroll } = await getSettings(tx)
  const item = await tx.payrollItem.findUnique({ where: { id: itemId }, include: { payrollRun: true, employee: true } })
  if (!item) throw new BusinessError('بند الراتب غير موجود')
  const run = item.payrollRun
  if (run.status !== 'DRAFT') throw new BusinessError('لا يمكن تعديل مسير معتمد أو ملغي')
  const emp = item.employee
  const last = fromDateOnly(monthEnd(run.year, run.month))

  // الساعات الإضافية المعلّقة حتى نهاية الشهر
  await tx.overtimeEntry.updateMany({ where: { payrollItemId: item.id, status: 'INCLUDED' }, data: { payrollItemId: null, status: 'PENDING' } })
  await tx.overtimeEntry.updateMany({
    where: { employeeId: emp.id, status: 'PENDING', date: { lte: last } },
    data: { payrollItemId: item.id, status: 'INCLUDED' },
  })
  const ot = await tx.overtimeEntry.aggregate({ where: { payrollItemId: item.id, status: 'INCLUDED' }, _sum: { hours: true, amount: true } })

  // أقساط السلف
  await tx.advanceDeduction.deleteMany({ where: { payrollItemId: item.id } })
  const plan = await planAdvances(tx, emp.id, run.year, run.month)

  const salaryType = options?.refreshRate ? emp.salaryType : item.salaryType
  const rate = options?.refreshRate ? emp.baseSalary : item.rate
  const calc = calcPayrollItem(
    {
      salaryType,
      rate: rate.toString(),
      workDays: item.workDays.toString(),
      workHours: item.workHours.toString(),
      absenceDays: item.absenceDays.toString(),
      lateHours: item.lateHours.toString(),
      overtimeAmount: D(ot._sum.amount).toString(),
      bonuses: item.bonuses.toString(),
      allowances: item.allowances.toString(),
      otherDeductions: item.otherDeductions.toString(),
      withholdings: item.withholdings.toString(),
      plannedAdvance: sum(plan.map((p) => p.planned)).toString(),
    },
    { workDaysPerMonth: payroll.workDaysPerMonth, hoursPerDay: payroll.hoursPerDay, decimals: finance.decimals },
  )
  // توزيع القسط الفعلي (بعد التخفيض إن لزم) على السلف: الأقدم أولًا
  let left = D(calc.advanceDeduction)
  for (const p of plan) {
    if (!left.greaterThan(0)) break
    const take = min(p.planned, left)
    await tx.advanceDeduction.create({ data: { advanceId: p.advanceId, payrollItemId: item.id, amount: toDb(take) } })
    left = left.minus(take)
  }
  return tx.payrollItem.update({
    where: { id: item.id },
    data: {
      salaryType,
      rate: toDb(rate),
      basicPay: toDb(calc.basicPay),
      absenceDeduction: toDb(calc.absenceDeduction),
      lateDeduction: toDb(calc.lateDeduction),
      overtimeHours: toDb(D(ot._sum.hours)),
      overtimeAmount: toDb(D(ot._sum.amount)),
      advanceDeduction: toDb(calc.advanceDeduction),
      grossPay: toDb(calc.grossPay),
      totalDeductions: toDb(calc.totalDeductions),
      netPay: toDb(calc.netPay),
    },
  })
}

async function addItem(tx: Tx, runId: number, employee: { id: number; salaryType: 'MONTHLY' | 'DAILY' | 'HOURLY'; baseSalary: Prisma.Decimal; hireDate: Date | null }, run: { year: number; month: number }) {
  const { payroll } = await getSettings(tx)
  const work = defaultWork(employee, run.year, run.month, payroll)
  const item = await tx.payrollItem.create({
    data: {
      payrollRunId: runId,
      employeeId: employee.id,
      salaryType: employee.salaryType,
      rate: toDb(employee.baseSalary),
      workDays: toDb(work.workDays),
      workHours: toDb(work.workHours),
    },
  })
  return recalculateItem(tx, item.id, { refreshRate: true })
}

/** احتساب رواتب شهر: مسودة لكل الموظفين الفعالين. */
export async function createPayrollRun(tx: Tx, ctx: Ctx, input: { year: number; month: number; postingDate?: DateOnly | null; notes?: string | null }) {
  const { year, month } = input
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new BusinessError('الشهر غير صالح', { month: 'غير صالح' })
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new BusinessError('السنة غير صالحة', { year: 'غير صالحة' })
  const exists = await tx.payrollRun.findFirst({ where: { year, month, status: { not: 'CANCELLED' } } })
  if (exists) throw new BusinessError(`يوجد مسير رواتب لشهر ${month}/${year} مسبقًا`, { month: 'موجود مسبقًا' })
  const postingDate = input.postingDate ?? monthEnd(year, month)
  const academicYear = await resolveOpenYear(tx, postingDate)
  const last = fromDateOnly(monthEnd(year, month))
  const employees = await tx.employee.findMany({
    where: { status: 'ACTIVE', OR: [{ hireDate: null }, { hireDate: { lte: last } }] },
    orderBy: [{ isTeacher: 'desc' }, { fullName: 'asc' }],
  })
  if (employees.length === 0) throw new BusinessError('لا يوجد موظفون فعالون لاحتساب رواتبهم')
  const run = await tx.payrollRun.create({
    data: { year, month, academicYearId: academicYear.id, postingDate: fromDateOnly(postingDate), notes: input.notes ?? null, createdById: ctx.userId },
  })
  for (const e of employees) await addItem(tx, run.id, e, run)
  await recomputeRunTotals(tx, run.id)
  const saved = await tx.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'PayrollRun',
    entityId: run.id,
    entityLabel: `مسير رواتب ${runLabel(run)}`,
    summary: `احتساب رواتب شهر ${runLabel(run)} (مسودة) لـ ${employees.length} موظف — الصافي ${D(saved.totalNet).toString()}`,
    after: saved,
  })
  return saved
}

/** إعادة احتساب المسودة: تحديث الرواتب من ملفات الموظفين، الإضافي، السلف، وإضافة الموظفين الجدد. */
export async function recalculateRun(tx: Tx, ctx: Ctx, runId: number) {
  const run = await lockRun(tx, runId)
  if (run.status !== 'DRAFT') throw new BusinessError('إعادة الاحتساب متاحة للمسودة فقط')
  const items = await tx.payrollItem.findMany({ where: { payrollRunId: runId }, select: { id: true, employeeId: true } })
  for (const it of items) await recalculateItem(tx, it.id, { refreshRate: true })
  const last = fromDateOnly(monthEnd(run.year, run.month))
  const missing = await tx.employee.findMany({
    where: { status: 'ACTIVE', id: { notIn: items.map((i) => i.employeeId) }, OR: [{ hireDate: null }, { hireDate: { lte: last } }] },
  })
  for (const e of missing) await addItem(tx, runId, e, run)
  await recomputeRunTotals(tx, runId)
  await audit(tx, ctx, {
    action: 'recalculate',
    entityType: 'PayrollRun',
    entityId: runId,
    entityLabel: `مسير رواتب ${runLabel(run)}`,
    summary: `إعادة احتساب مسير رواتب ${runLabel(run)}${missing.length ? ` وإضافة ${missing.length} موظف جديد` : ''}`,
  })
}

export interface PayrollItemInput {
  workDays: string
  workHours: string
  absenceDays: string
  lateHours: string
  bonuses: string
  allowances: string
  otherDeductions: string
  withholdings: string
  notes?: string | null
}

/** تعديل مدخلات بند (غياب، تأخير، مكافآت...) في المسودة وإعادة حسابه. */
export async function updatePayrollItem(tx: Tx, ctx: Ctx, itemId: number, input: PayrollItemInput) {
  const before = await tx.payrollItem.findUnique({ where: { id: itemId }, include: { payrollRun: true, employee: true } })
  if (!before) throw new BusinessError('بند الراتب غير موجود')
  if (before.payrollRun.status !== 'DRAFT') throw new BusinessError('لا يمكن تعديل مسير معتمد أو ملغي')
  const v = {
    workDays: D(input.workDays),
    workHours: D(input.workHours),
    absenceDays: D(input.absenceDays),
    lateHours: D(input.lateHours),
    bonuses: D(input.bonuses),
    allowances: D(input.allowances),
    otherDeductions: D(input.otherDeductions),
    withholdings: D(input.withholdings),
  }
  for (const [k, x] of Object.entries(v)) if (x.isNegative()) throw new BusinessError('القيم لا يمكن أن تكون سالبة', { [k]: 'قيمة سالبة' })
  if (v.workDays.greaterThan(31) || v.absenceDays.greaterThan(31)) throw new BusinessError('عدد الأيام لا يتجاوز 31', { workDays: 'غير صالح' })
  if (v.workHours.greaterThan(744) || v.lateHours.greaterThan(744)) throw new BusinessError('عدد الساعات غير صالح', { workHours: 'غير صالح' })
  const { finance } = await getSettings(tx)
  await tx.payrollItem.update({
    where: { id: itemId },
    data: {
      workDays: toDb(v.workDays),
      workHours: toDb(v.workHours),
      absenceDays: toDb(v.absenceDays),
      lateHours: toDb(v.lateHours),
      bonuses: toDb(round(v.bonuses, finance.decimals)),
      allowances: toDb(round(v.allowances, finance.decimals)),
      otherDeductions: toDb(round(v.otherDeductions, finance.decimals)),
      withholdings: toDb(round(v.withholdings, finance.decimals)),
      notes: input.notes ?? null,
    },
  })
  const after = await recalculateItem(tx, itemId)
  if (D(after.netPay).isNegative()) throw new BusinessError(`خصومات ${before.employee.fullName} أكبر من إجمالي راتبه`)
  await recomputeRunTotals(tx, before.payrollRunId)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'PayrollItem',
    entityId: itemId,
    entityLabel: `${before.employee.fullName} — ${runLabel(before.payrollRun)}`,
    before,
    after,
  })
  return after
}

export async function removePayrollItem(tx: Tx, ctx: Ctx, itemId: number) {
  const item = await tx.payrollItem.findUnique({ where: { id: itemId }, include: { payrollRun: true, employee: true } })
  if (!item) throw new BusinessError('بند الراتب غير موجود')
  if (item.payrollRun.status !== 'DRAFT') throw new BusinessError('لا يمكن تعديل مسير معتمد أو ملغي')
  await tx.overtimeEntry.updateMany({ where: { payrollItemId: itemId, status: 'INCLUDED' }, data: { payrollItemId: null, status: 'PENDING' } })
  await tx.advanceDeduction.deleteMany({ where: { payrollItemId: itemId } })
  await tx.payrollItem.delete({ where: { id: itemId } })
  await recomputeRunTotals(tx, item.payrollRunId)
  await audit(tx, ctx, {
    action: 'delete',
    entityType: 'PayrollItem',
    entityId: itemId,
    entityLabel: `${item.employee.fullName} — ${runLabel(item.payrollRun)}`,
    summary: `استبعاد ${item.employee.fullName} من مسودة رواتب ${runLabel(item.payrollRun)}`,
    before: item,
  })
}

export async function addEmployeeToRun(tx: Tx, ctx: Ctx, runId: number, employeeId: number) {
  const run = await lockRun(tx, runId)
  if (run.status !== 'DRAFT') throw new BusinessError('لا يمكن تعديل مسير معتمد أو ملغي')
  const emp = await tx.employee.findUnique({ where: { id: employeeId } })
  if (!emp) throw new BusinessError('الموظف غير موجود')
  if (await tx.payrollItem.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } })) throw new BusinessError('الموظف موجود في المسير')
  const item = await addItem(tx, runId, emp, run)
  await recomputeRunTotals(tx, runId)
  await audit(tx, ctx, { action: 'create', entityType: 'PayrollItem', entityId: item.id, entityLabel: `${emp.fullName} — ${runLabel(run)}`, summary: `إضافة ${emp.fullName} إلى مسودة رواتب ${runLabel(run)}`, after: item })
  return item
}

// ---------------------------------------------------------------------
// الاعتماد والإلغاء
// ---------------------------------------------------------------------

/**
 * اعتماد المسير: م مصروف الرواتب / د رواتب مستحقة (لكل موظف) / د سلف الموظفين / د استقطاعات مستحقة.
 */
export async function approveRun(tx: Tx, ctx: Ctx, runId: number) {
  const { finance } = await getSettings(tx)
  const run = await lockRun(tx, runId)
  if (run.status !== 'DRAFT') throw new BusinessError('المسير ليس مسودة')
  const items = await tx.payrollItem.findMany({
    where: { payrollRunId: runId },
    include: { employee: true, advanceDeductions: true },
    orderBy: { id: 'asc' },
  })
  if (items.length === 0) throw new BusinessError('المسير لا يحتوي على موظفين')
  const last = fromDateOnly(monthEnd(run.year, run.month))
  const newOvertime = await tx.overtimeEntry.count({ where: { employeeId: { in: items.map((i) => i.employeeId) }, status: 'PENDING', date: { lte: last } } })
  if (newOvertime > 0) throw new BusinessError('سُجلت ساعات إضافية جديدة بعد آخر احتساب. اضغط «إعادة الاحتساب» ثم اعتمد المسير.')
  for (const it of items) if (D(it.netPay).isNegative()) throw new BusinessError(`صافي راتب ${it.employee.fullName} سالب`)

  // التحقق من أقساط السلف مقابل المتبقي الفعلي (مع قفل السلف)
  const perAdvance = new Map<number, Decimal>()
  for (const it of items) for (const d of it.advanceDeductions) perAdvance.set(d.advanceId, (perAdvance.get(d.advanceId) ?? D(0)).plus(D(d.amount)))
  if (perAdvance.size) await tx.$queryRaw`SELECT "id" FROM "employee_advances" WHERE "id" IN (${Prisma.join([...perAdvance.keys()])}) FOR UPDATE`
  const advances = perAdvance.size ? await tx.employeeAdvance.findMany({ where: { id: { in: [...perAdvance.keys()] } } }) : []
  for (const a of advances) {
    const remaining = D(a.amount).minus(D(a.deductedAmount))
    if (a.status !== 'ACTIVE' || perAdvance.get(a.id)!.greaterThan(remaining)) {
      throw new BusinessError('تغيرت بيانات إحدى السلف منذ الاحتساب. اضغط «إعادة الاحتساب» ثم اعتمد المسير.')
    }
  }

  const [expense, payable, advancesAcc, withholdingsAcc] = await Promise.all([
    accountIdByKey(tx, 'SALARIES_EXPENSE'),
    accountIdByKey(tx, 'SALARIES_PAYABLE'),
    accountIdByKey(tx, 'EMPLOYEE_ADVANCES'),
    accountIdByKey(tx, 'WITHHOLDINGS_PAYABLE'),
  ])
  const label = runLabel(run)
  const lines: JournalLineInput[] = []
  for (const it of items) {
    const net = D(it.netPay)
    const adv = D(it.advanceDeduction)
    const wh = D(it.withholdings)
    const cost = net.plus(adv).plus(wh)
    if (cost.isZero()) continue
    const who = it.employee.fullName
    lines.push({ accountId: expense, debit: cost, employeeId: it.employeeId, description: `راتب ${label} — ${who}` })
    lines.push({ accountId: payable, credit: net, employeeId: it.employeeId, description: `صافي راتب ${label} — ${who}` })
    lines.push({ accountId: advancesAcc, credit: adv, employeeId: it.employeeId, description: `قسط سلفة من راتب ${label} — ${who}` })
    lines.push({ accountId: withholdingsAcc, credit: wh, employeeId: it.employeeId, description: `استقطاعات راتب ${label} — ${who}` })
  }
  if (lines.length === 0) throw new BusinessError('لا توجد مبالغ في المسير لاعتمادها')
  const entry = await postEntry(tx, ctx, {
    date: toDateOnly(run.postingDate),
    description: `مسير رواتب شهر ${label} (${items.length} موظف)`,
    sourceType: 'PAYROLL',
    sourceId: run.id,
    lines,
  })
  for (const a of advances) {
    const deducted = D(a.deductedAmount).plus(perAdvance.get(a.id)!)
    await tx.employeeAdvance.update({
      where: { id: a.id },
      data: { deductedAmount: toDb(deducted), status: deducted.greaterThanOrEqualTo(D(a.amount)) ? 'SETTLED' : 'ACTIVE' },
    })
  }
  const approved = await tx.payrollRun.update({
    where: { id: runId },
    data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ctx.userId, journalEntryId: entry.id },
  })
  await audit(tx, ctx, {
    action: 'approve',
    entityType: 'PayrollRun',
    entityId: runId,
    entityLabel: `مسير رواتب ${label}`,
    summary: `اعتماد مسير رواتب ${label}: الإجمالي ${D(run.totalGross).toFixed(finance.decimals)} — الصافي ${D(run.totalNet).toFixed(finance.decimals)} (${items.length} موظف)`,
    before: { status: run.status },
    after: { status: approved.status, journalEntryId: entry.id },
  })
  return approved
}

/** إلغاء مسير: المسودة تُلغى مباشرة؛ المعتمد فقط إذا لم يُصرف منه شيء (بقيد عكسي وتعود الإضافي والسلف معلّقة). */
export async function cancelRun(tx: Tx, ctx: Ctx, runId: number, reason: string) {
  const run = await lockRun(tx, runId)
  if (run.status === 'CANCELLED') throw new BusinessError('المسير ملغي مسبقًا')
  const label = runLabel(run)
  const items = await tx.payrollItem.findMany({ where: { payrollRunId: runId }, include: { advanceDeductions: true } })
  const itemIds = items.map((i) => i.id)
  let reversalId: number | null = null
  if (run.status === 'APPROVED') {
    const paid = await tx.paymentVoucher.count({ where: { payrollItemId: { in: itemIds }, status: 'ACTIVE' } })
    if (paid > 0) throw new BusinessError('صُرفت رواتب من هذا المسير. ألغِ سندات صرف الرواتب أولًا ثم ألغِ المسير.')
    if (run.journalEntryId) {
      const rev = await reverseEntry(tx, ctx, run.journalEntryId, { date: await todayOf(tx), description: `إلغاء مسير رواتب ${label} — ${reason}`, sourceType: 'PAYROLL_CANCEL' })
      reversalId = rev.id
    }
    // إرجاع أقساط السلف المخصومة
    const perAdvance = new Map<number, Decimal>()
    for (const it of items) for (const d of it.advanceDeductions) perAdvance.set(d.advanceId, (perAdvance.get(d.advanceId) ?? D(0)).plus(D(d.amount)))
    for (const [advanceId, amount] of perAdvance) {
      const a = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: advanceId } })
      const deducted = D(a.deductedAmount).minus(amount)
      await tx.employeeAdvance.update({
        where: { id: advanceId },
        data: { deductedAmount: toDb(deducted.isNegative() ? 0 : deducted), status: a.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' },
      })
    }
  } else {
    // المسودة: أقساط السلف فيها تخطيط فقط
    await tx.advanceDeduction.deleteMany({ where: { payrollItemId: { in: itemIds } } })
  }
  await tx.overtimeEntry.updateMany({ where: { payrollItemId: { in: itemIds }, status: 'INCLUDED' }, data: { payrollItemId: null, status: 'PENDING' } })
  await tx.payrollRun.update({
    where: { id: runId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, reversalEntryId: reversalId },
  })
  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'PayrollRun',
    entityId: runId,
    entityLabel: `مسير رواتب ${label}`,
    summary: `إلغاء ${run.status === 'APPROVED' ? 'مسير رواتب معتمد' : 'مسودة رواتب'} ${label} — ${reason}`,
    before: { status: run.status },
    after: { status: 'CANCELLED' },
  })
}

// ---------------------------------------------------------------------
// الساعات الإضافية (§5.17)
// ---------------------------------------------------------------------

export async function createOvertime(
  tx: Tx,
  ctx: Ctx,
  input: { employeeId: number; date: DateOnly; hours: string; rate?: string | null; reason?: string | null; notes?: string | null },
) {
  const { finance, payroll } = await getSettings(tx)
  const emp = await tx.employee.findUnique({ where: { id: input.employeeId } })
  if (!emp) throw new BusinessError('الموظف غير موجود', { employeeId: 'اختر الموظف' })
  if (emp.status !== 'ACTIVE') throw new BusinessError('الموظف غير فعال')
  const hours = D(input.hours)
  if (!hours.greaterThan(0) || hours.greaterThan(300)) throw new BusinessError('عدد الساعات غير صالح', { hours: 'غير صالح' })
  const rate = input.rate ? D(input.rate) : emp.overtimeRate ? D(emp.overtimeRate) : derivedRates(emp.salaryType, emp.baseSalary, payroll).hourly
  if (!rate.greaterThan(0)) throw new BusinessError('حدد سعر الساعة', { rate: 'مطلوب' })
  const amount = round(hours.times(rate), finance.decimals)
  const { y, m } = parts(input.date)
  const approved = await tx.payrollRun.findFirst({ where: { year: y, month: m, status: 'APPROVED' } })
  if (approved) throw new BusinessError(`مسير رواتب شهر ${m}/${y} معتمد. سجّل الإضافي بتاريخ في الشهر التالي ليُصرف مع رواتبه.`, { date: 'الشهر مغلق' })
  const row = await tx.overtimeEntry.create({
    data: {
      employeeId: emp.id,
      date: fromDateOnly(input.date),
      hours: toDb(hours),
      rate: toDb(round(rate, 3)),
      amount: toDb(amount),
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'OvertimeEntry',
    entityId: row.id,
    entityLabel: emp.fullName,
    summary: `ساعات إضافية للموظف ${emp.fullName}: ${hours.toString()} ساعة × ${round(rate, finance.decimals).toString()} = ${amount.toFixed(finance.decimals)}`,
    after: row,
  })
  return row
}

export async function cancelOvertime(tx: Tx, ctx: Ctx, id: number, reason: string) {
  const row = await tx.overtimeEntry.findUnique({ where: { id }, include: { employee: true, payrollItem: { include: { payrollRun: true } } } })
  if (!row) throw new BusinessError('السجل غير موجود')
  if (row.status === 'CANCELLED') throw new BusinessError('السجل ملغي مسبقًا')
  if (row.payrollItem && row.payrollItem.payrollRun.status === 'APPROVED') throw new BusinessError('هذه الساعات صُرفت ضمن مسير رواتب معتمد، ولا يمكن إلغاؤها')
  await tx.overtimeEntry.update({ where: { id }, data: { status: 'CANCELLED', payrollItemId: null } })
  // إن كانت ضمن مسودة: يُعاد حساب بند الموظف
  if (row.payrollItem && row.payrollItem.payrollRun.status === 'DRAFT') {
    await recalculateItem(tx, row.payrollItem.id)
    await recomputeRunTotals(tx, row.payrollItem.payrollRunId)
  }
  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'OvertimeEntry',
    entityId: id,
    entityLabel: row.employee.fullName,
    summary: `إلغاء ساعات إضافية (${row.hours.toString()} ساعة) للموظف ${row.employee.fullName} — ${reason}`,
    before: row,
  })
}

/** بعد إلغاء سلفة: إزالة أقساطها من المسودات وإعادة حساب البنود المتأثرة. */
export async function releaseAdvanceFromDrafts(tx: Tx, advanceId: number) {
  const rows = await tx.advanceDeduction.findMany({ where: { advanceId, payrollItem: { payrollRun: { status: 'DRAFT' } } }, include: { payrollItem: true } })
  if (!rows.length) return
  await tx.advanceDeduction.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
  for (const r of rows) {
    await recalculateItem(tx, r.payrollItemId)
    await recomputeRunTotals(tx, r.payrollItem.payrollRunId)
  }
}

// ---------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------

export async function listPayrollRuns(client: DbOrTx, f: { year?: number; status?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 24, 5), 500)
  const page = Math.max(f.page ?? 1, 1)
  const where: Prisma.PayrollRunWhereInput = {
    ...(f.year ? { year: f.year } : {}),
    ...(f.status === 'DRAFT' || f.status === 'APPROVED' || f.status === 'CANCELLED' ? { status: f.status } : {}),
  }
  const [rows, total] = await Promise.all([
    client.payrollRun.findMany({
      where,
      include: { _count: { select: { items: true } }, createdBy: { select: { fullName: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.payrollRun.count({ where }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getPayrollRun(client: DbOrTx, id: number) {
  return client.payrollRun.findUnique({
    where: { id },
    include: {
      academicYear: true,
      createdBy: { select: { fullName: true } },
      items: {
        include: {
          employee: { select: { id: true, fullName: true, employeeNumber: true, jobTitle: true, department: true, isTeacher: true, status: true } },
          advanceDeductions: true,
        },
        orderBy: [{ employee: { isTeacher: 'desc' } }, { employee: { fullName: 'asc' } }],
      },
    },
  })
}

export async function getPayslip(client: DbOrTx, itemId: number) {
  return client.payrollItem.findUnique({
    where: { id: itemId },
    include: {
      payrollRun: true,
      employee: true,
      overtimeEntries: { where: { status: 'INCLUDED' }, orderBy: { date: 'asc' } },
      advanceDeductions: { include: { advance: true } },
      vouchers: { where: { status: 'ACTIVE' }, orderBy: { date: 'asc' }, select: { id: true, number: true, date: true, amount: true, paymentMethod: true } },
    },
  })
}

export async function listOvertime(client: DbOrTx, f: { employeeId?: number; status?: string; from?: DateOnly; to?: DateOnly; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const and: Prisma.OvertimeEntryWhereInput[] = []
  if (f.employeeId) and.push({ employeeId: f.employeeId })
  if (f.status === 'PENDING' || f.status === 'INCLUDED' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  const where = and.length ? { AND: and } : {}
  const [rows, total, sums] = await Promise.all([
    client.overtimeEntry.findMany({
      where,
      include: {
        employee: { select: { id: true, fullName: true, employeeNumber: true } },
        payrollItem: { select: { payrollRunId: true, payrollRun: { select: { year: true, month: true, status: true } } } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.overtimeEntry.count({ where }),
    client.overtimeEntry.aggregate({ where: { AND: [where, { status: { not: 'CANCELLED' } }] }, _sum: { hours: true, amount: true } }),
  ])
  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    totalHours: D(sums._sum.hours).toString(),
    totalAmount: D(sums._sum.amount).toString(),
  }
}
