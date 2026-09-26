import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { PaymentMethod } from '@/generated/prisma/enums'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings } from '../settings'
import { createVoucher } from './vouchers'
import { recalculateItem } from './payroll'
import { D, Decimal, round, toDb } from '@/lib/money'
import { fromDateOnly, parts, type DateOnly } from '@/lib/dates'

/**
 * سلف الموظفين (docs/05-workflows.md §5.18):
 * تُصرف بسند صرف «سلفة» (م سلف الموظفين / د الصندوق)، وتُخصم أقساطها تلقائيًا في مسيرات الرواتب.
 */

export interface AdvanceInput {
  employeeId: number
  date: DateOnly
  amount: string
  installmentsCount: number
  monthlyDeduction?: string | null
  startYear?: number | null
  startMonth?: number | null
  reason?: string | null
  notes?: string | null
  cashAccountId: number
  paymentMethod: PaymentMethod
  cheque?: { number: string; bankName?: string | null; dueDate: DateOnly } | null
  referenceNumber?: string | null
}

export async function createAdvance(tx: Tx, ctx: Ctx, input: AdvanceInput) {
  const { finance } = await getSettings(tx)
  const emp = await tx.employee.findUnique({ where: { id: input.employeeId } })
  if (!emp) throw new BusinessError('الموظف غير موجود', { employeeId: 'اختر الموظف' })
  if (emp.status !== 'ACTIVE') throw new BusinessError('الموظف غير فعال')
  const amount = round(input.amount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  const count = Math.trunc(input.installmentsCount)
  if (!(count >= 1 && count <= 60)) throw new BusinessError('عدد الأقساط بين 1 و 60', { installmentsCount: 'غير صالح' })
  // القسط الشهري: التقريب للأعلى حتى لا يتبقى كسر بعد آخر قسط
  const monthly = input.monthlyDeduction
    ? round(input.monthlyDeduction, finance.decimals)
    : D(amount).dividedBy(count).toDecimalPlaces(finance.decimals, Decimal.ROUND_UP)
  if (!monthly.greaterThan(0) || monthly.greaterThan(amount)) throw new BusinessError('قسط الخصم الشهري غير صالح', { monthlyDeduction: 'غير صالح' })

  // شهر بدء الخصم: الافتراضي شهر السلفة، أو التالي إن كان مسيره معتمدًا
  const d = parts(input.date)
  let startYear = input.startYear ?? d.y
  let startMonth = input.startMonth ?? d.m
  const closed = async (y: number, m: number) => !!(await tx.payrollRun.findFirst({ where: { year: y, month: m, status: 'APPROVED' } }))
  if (!input.startYear && (await closed(startYear, startMonth))) {
    startMonth += 1
    if (startMonth > 12) {
      startMonth = 1
      startYear += 1
    }
  }
  if (startMonth < 1 || startMonth > 12) throw new BusinessError('شهر بدء الخصم غير صالح', { startMonth: 'غير صالح' })
  if (await closed(startYear, startMonth)) throw new BusinessError(`مسير رواتب ${startMonth}/${startYear} معتمد؛ اختر شهرًا لاحقًا لبدء الخصم`, { startMonth: 'الشهر مغلق' })

  const advance = await tx.employeeAdvance.create({
    data: {
      employeeId: emp.id,
      date: fromDateOnly(input.date),
      amount: toDb(amount),
      installmentsCount: count,
      monthlyDeduction: toDb(monthly),
      startYear,
      startMonth,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  })
  const voucher = await createVoucher(tx, ctx, {
    kind: 'ADVANCE',
    date: input.date,
    amount: amount.toString(),
    paymentMethod: input.paymentMethod,
    cashAccountId: input.cashAccountId,
    advanceId: advance.id,
    cheque: input.cheque ?? null,
    referenceNumber: input.referenceNumber ?? null,
    description: input.reason ? `سلفة: ${input.reason}` : `سلفة على الراتب تُخصم على ${count} ${count === 1 ? 'دفعة' : 'أقساط'}`,
    notes: input.notes ?? null,
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'EmployeeAdvance',
    entityId: advance.id,
    entityLabel: emp.fullName,
    summary: `سلفة للموظف ${emp.fullName} بمبلغ ${amount.toFixed(finance.decimals)} تُخصم ${monthly.toFixed(finance.decimals)} شهريًا ابتداءً من ${startMonth}/${startYear} (سند ${voucher.number})`,
    after: advance,
  })
  return { advance, voucher }
}

/** تعديل القسط الشهري أو شهر البدء لسلفة قائمة (تتحدث المسودات تلقائيًا). */
export async function updateAdvanceSchedule(tx: Tx, ctx: Ctx, advanceId: number, input: { monthlyDeduction: string; startYear: number; startMonth: number; reason: string }) {
  const { finance } = await getSettings(tx)
  const before = await tx.employeeAdvance.findUnique({ where: { id: advanceId }, include: { employee: true } })
  if (!before) throw new BusinessError('السلفة غير موجودة')
  if (before.status !== 'ACTIVE') throw new BusinessError('السلفة مسددة أو ملغاة')
  const monthly = round(input.monthlyDeduction, finance.decimals)
  const remaining = D(before.amount).minus(D(before.deductedAmount))
  if (!monthly.greaterThan(0) || monthly.greaterThan(before.amount)) throw new BusinessError('القسط الشهري غير صالح', { monthlyDeduction: 'غير صالح' })
  if (input.startMonth < 1 || input.startMonth > 12) throw new BusinessError('شهر البدء غير صالح', { startMonth: 'غير صالح' })
  const after = await tx.employeeAdvance.update({
    where: { id: advanceId },
    data: { monthlyDeduction: toDb(monthly), startYear: input.startYear, startMonth: input.startMonth },
  })
  // تحديث مسودات الرواتب التي تتضمن هذه السلفة أو هذا الموظف
  const drafts = await tx.payrollItem.findMany({ where: { employeeId: before.employeeId, payrollRun: { status: 'DRAFT' } }, select: { id: true } })
  for (const it of drafts) await recalculateItem(tx, it.id)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'EmployeeAdvance',
    entityId: advanceId,
    entityLabel: before.employee.fullName,
    summary: `تعديل جدول خصم سلفة ${before.employee.fullName}: ${D(before.monthlyDeduction).toFixed(finance.decimals)} ← ${monthly.toFixed(finance.decimals)} شهريًا (المتبقي ${remaining.toFixed(finance.decimals)}) — ${input.reason}`,
    before,
    after,
  })
  return after
}

export async function listAdvances(client: DbOrTx, f: { employeeId?: number; status?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const where: Prisma.EmployeeAdvanceWhereInput = {
    ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    ...(f.status === 'ACTIVE' || f.status === 'SETTLED' || f.status === 'CANCELLED' ? { status: f.status } : {}),
  }
  const [rows, total, sums] = await Promise.all([
    client.employeeAdvance.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true, employeeNumber: true } }, voucher: { select: { id: true, number: true, status: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.employeeAdvance.count({ where }),
    client.employeeAdvance.aggregate({ where: { AND: [where, { status: { not: 'CANCELLED' } }] }, _sum: { amount: true, deductedAmount: true } }),
  ])
  return {
    rows,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    totalAmount: D(sums._sum.amount).toString(),
    totalDeducted: D(sums._sum.deductedAmount).toString(),
  }
}
