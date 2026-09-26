import 'server-only'
import { randomUUID } from 'node:crypto'
import type { DiscountMethod } from '@/generated/prisma/enums'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { assertYearOpen } from '../years'
import { postEntry, reverseEntry } from '../ledger/posting'
import { accountIdByKey } from '../ledger/accounts'
import { D, distributeProportional, min, percentOf, round, sum, toDb, ZERO } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import {
  generateSchedule,
  paymentStatusOf,
  recomputeCharge,
  recomputeInstallment,
  redistributeInstallments,
  validateCustomSchedule,
  type ScheduleLine,
} from './installments'
import type Decimal from 'decimal.js'

/**
 * الذمم والخصومات (docs/05-workflows.md §5.2 – §5.13)
 * كل عملية: تحديث الجداول التشغيلية + القيد المحاسبي + سجل النشاط في نفس المعاملة.
 */

export interface DiscountSpec {
  method: DiscountMethod
  value: string
  discountTypeId?: number | null
  reason: string
  approvedBy?: string | null
  ruleId?: number | null
}

export interface CreateChargeInput {
  studentId: number
  chargeTypeId: number
  academicYearId: number
  date: DateOnly
  dueDate?: DateOnly | null
  grossAmount: string
  description?: string | null
  notes?: string | null
  discount?: DiscountSpec | null
  installments?: {
    count: number
    firstDueDate: DateOnly
    dueDay?: number | null
    schedule?: { dueDate: DateOnly; amount: string }[] | null
  } | null
  applyRules?: boolean
  bulkBatchId?: string | null
  importBatchId?: number | null
  /** للاستيراد: جدول أقساط جاهز مع مدفوعات سابقة لا تُنشئ قبضًا */
  skipAudit?: boolean
}

function discountAmountFor(spec: { method: DiscountMethod; value: string }, base: Decimal, decimals: number): Decimal {
  const value = D(spec.value)
  if (value.isNegative()) throw new BusinessError('قيمة الخصم لا يمكن أن تكون سالبة')
  if (spec.method === 'PERCENT') {
    if (value.greaterThan(100)) throw new BusinessError('نسبة الخصم لا يمكن أن تتجاوز 100%')
    return percentOf(base, value, decimals)
  }
  return round(value, decimals)
}

/** الخصومات الدائمة المنطبقة على ذمة جديدة. */
async function matchingRules(tx: DbOrTx, studentId: number, chargeTypeId: number, academicYearId: number) {
  return tx.studentDiscountRule.findMany({
    where: {
      studentId,
      isActive: true,
      AND: [
        { OR: [{ chargeTypeId: null }, { chargeTypeId }] },
        { OR: [{ academicYearId: null }, { academicYearId }] },
      ],
    },
    include: { discountType: true },
    orderBy: { id: 'asc' },
  })
}

export async function createCharge(tx: Tx, ctx: Ctx, input: CreateChargeInput) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const student = await tx.student.findUnique({ where: { id: input.studentId } })
  if (!student) throw new BusinessError('الطالب غير موجود')
  const chargeType = await tx.chargeType.findUnique({ where: { id: input.chargeTypeId } })
  if (!chargeType || !chargeType.isActive) throw new BusinessError('نوع الذمة غير موجود أو معطّل', { chargeTypeId: 'اختر نوع الذمة' })
  const year = await assertYearOpen(tx, input.academicYearId)
  const gross = round(input.grossAmount, decimals)
  if (!gross.greaterThan(0)) throw new BusinessError('قيمة الذمة يجب أن تكون أكبر من صفر', { grossAmount: 'أكبر من صفر' })

  // الخصومات: المحددة يدويًا + الدائمة (إن طُلب تطبيقها)
  const specs: DiscountSpec[] = []
  if (input.discount && D(input.discount.value).greaterThan(0)) specs.push(input.discount)
  if (input.applyRules) {
    for (const rule of await matchingRules(tx, input.studentId, input.chargeTypeId, input.academicYearId)) {
      specs.push({
        method: rule.method,
        value: rule.value.toString(),
        discountTypeId: rule.discountTypeId,
        reason: rule.reason,
        approvedBy: rule.approvedBy,
        ruleId: rule.id,
      })
    }
  }
  let remaining = gross
  const appliedDiscounts: { spec: DiscountSpec; amount: Decimal }[] = []
  for (const spec of specs) {
    const amt = min(discountAmountFor(spec, gross, decimals), remaining)
    if (amt.greaterThan(0)) {
      appliedDiscounts.push({ spec, amount: amt })
      remaining = remaining.minus(amt)
    }
  }
  if (input.discount && specs[0] === input.discount) {
    const requested = discountAmountFor(input.discount, gross, decimals)
    if (requested.greaterThan(gross)) throw new BusinessError('الخصم أكبر من قيمة الذمة', { 'discount.value': 'أكبر من قيمة الذمة' })
  }
  const totalDiscount = sum(appliedDiscounts.map((d) => d.amount))
  const net = gross.minus(totalDiscount)

  // جدول الأقساط
  let schedule: ScheduleLine[]
  const inst = input.installments
  if (inst && inst.count > 1 && !chargeType.allowInstallments && chargeType.systemKey !== 'OPENING_BALANCE') {
    // مسموح دائمًا، لكن نحترم إعداد التصنيف كافتراضي فقط
  }
  if (inst && (inst.count > 1 || (inst.schedule && inst.schedule.length > 0))) {
    if (inst.schedule && inst.schedule.length > 0) {
      validateCustomSchedule(inst.schedule, net)
      schedule = inst.schedule.map((l) => ({ dueDate: l.dueDate, amount: round(l.amount, decimals) }))
    } else {
      schedule = generateSchedule(net, inst.count, inst.firstDueDate, decimals, inst.dueDay)
    }
  } else {
    schedule = [{ dueDate: input.dueDate ?? inst?.firstDueDate ?? input.date, amount: net }]
  }

  const charge = await tx.charge.create({
    data: {
      studentId: input.studentId,
      chargeTypeId: input.chargeTypeId,
      academicYearId: input.academicYearId,
      date: fromDateOnly(input.date),
      description: input.description ?? null,
      notes: input.notes ?? null,
      grossAmount: toDb(gross),
      discountAmount: '0',
      netAmount: toDb(gross),
      paidAmount: '0',
      paymentStatus: 'UNPAID',
      isInstallment: schedule.length > 1,
      installmentCount: schedule.length,
      bulkBatchId: input.bulkBatchId ?? null,
      importBatchId: input.importBatchId ?? null,
      createdById: ctx.userId,
    },
  })

  // قيد الذمة: من ذمم الطلاب إلى إيراد نوع الذمة (بالمبلغ قبل الخصم)
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  const label = `${chargeType.name}${input.description ? ` — ${input.description}` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: `ذمة ${label} — ${student.fullName} (${year.name})`,
    sourceType: 'CHARGE',
    sourceId: charge.id,
    lines: [
      { accountId: ar, debit: gross, studentId: student.id, description: `ذمة: ${label}` },
      { accountId: chargeType.revenueAccountId, credit: gross, studentId: student.id, description: `ذمة: ${label}` },
    ],
  })
  await tx.charge.update({ where: { id: charge.id }, data: { journalEntryId: entry.id } })

  // الخصومات (كل خصم بقيد مستقل حتى يظهر في التقارير)
  for (const d of appliedDiscounts) {
    await recordDiscount(tx, ctx, {
      studentId: student.id,
      studentName: student.fullName,
      academicYearId: input.academicYearId,
      date: input.date,
      scope: 'CHARGE',
      chargeId: charge.id,
      chargeTypeId: null,
      spec: d.spec,
      applications: [{ chargeId: charge.id, base: gross, amount: d.amount }],
      chargeLabel: label,
    })
  }

  // الأقساط (بعد الخصم)
  await tx.installment.createMany({
    data: schedule.map((l, i) => ({
      chargeId: charge.id,
      studentId: student.id,
      academicYearId: input.academicYearId,
      number: i + 1,
      dueDate: fromDateOnly(l.dueDate),
      amount: toDb(l.amount),
      status: l.amount.isZero() ? 'PAID' : 'UNPAID',
    })),
  })
  await recomputeCharge(tx, charge.id)

  const result = await tx.charge.findUniqueOrThrow({ where: { id: charge.id }, include: { installments: true } })
  if (!input.skipAudit) {
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'Charge',
      entityId: charge.id,
      entityLabel: `${label} — ${student.fullName}`,
      summary: `إضافة ذمة ${label} للطالب ${student.fullName}: ${gross.toFixed(decimals)}${totalDiscount.greaterThan(0) ? ` (خصم ${totalDiscount.toFixed(decimals)}، الصافي ${net.toFixed(decimals)})` : ''}${schedule.length > 1 ? ` مقسطة على ${schedule.length} أقساط` : ''}`,
      after: { ...result, installments: result.installments.map((i) => ({ number: i.number, dueDate: i.dueDate, amount: i.amount })) },
    })
  }
  return result
}

/** إنشاء سجل خصم مع توزيعه على الذمم وقيده المحاسبي. */
async function recordDiscount(
  tx: Tx,
  ctx: Ctx,
  data: {
    studentId: number
    studentName: string
    academicYearId: number
    date: DateOnly
    scope: 'CHARGE' | 'CHARGE_TYPE' | 'ACCOUNT'
    chargeId: number | null
    chargeTypeId: number | null
    spec: DiscountSpec
    applications: { chargeId: number; base: Decimal; amount: Decimal }[]
    distribution?: 'EVEN' | 'FROM_LAST'
    chargeLabel?: string
  },
) {
  const baseAmount = sum(data.applications.map((a) => a.base))
  const amount = sum(data.applications.map((a) => a.amount))
  const discount = await tx.discount.create({
    data: {
      studentId: data.studentId,
      discountTypeId: data.spec.discountTypeId ?? null,
      academicYearId: data.academicYearId,
      scope: data.scope,
      chargeId: data.chargeId,
      chargeTypeId: data.chargeTypeId,
      method: data.spec.method,
      value: toDb(data.spec.value),
      distribution: data.distribution ?? 'EVEN',
      baseAmount: toDb(baseAmount),
      amount: toDb(amount),
      netAmount: toDb(baseAmount.minus(amount)),
      reason: data.spec.reason,
      approvedBy: data.spec.approvedBy ?? null,
      ruleId: data.spec.ruleId ?? null,
      date: fromDateOnly(data.date),
      createdById: ctx.userId,
      applications: {
        create: data.applications.map((a) => ({ chargeId: a.chargeId, baseAmount: toDb(a.base), amount: toDb(a.amount) })),
      },
    },
    include: { discountType: true },
  })
  const typeName = discount.discountType?.name ?? 'خصم'
  const methodText = data.spec.method === 'PERCENT' ? `${D(data.spec.value).toString()}%` : 'مبلغ ثابت'
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  const discAcc = await accountIdByKey(tx, 'DISCOUNTS_ALLOWED')
  const desc = `${typeName} (${methodText})${data.chargeLabel ? ` على ${data.chargeLabel}` : ''} — ${data.spec.reason}`
  const entry = await postEntry(tx, ctx, {
    date: data.date,
    description: `${desc} — ${data.studentName}`,
    sourceType: 'DISCOUNT',
    sourceId: discount.id,
    lines: [
      { accountId: discAcc, debit: amount, studentId: data.studentId, description: desc },
      { accountId: ar, credit: amount, studentId: data.studentId, description: desc },
    ],
  })
  await tx.discount.update({ where: { id: discount.id }, data: { journalEntryId: entry.id } })
  return discount
}

export interface AddDiscountInput {
  studentId: number
  scope: 'CHARGE' | 'CHARGE_TYPE' | 'ACCOUNT'
  chargeId?: number | null
  chargeTypeId?: number | null
  academicYearId: number
  method: DiscountMethod
  value: string
  discountTypeId?: number | null
  reason: string
  approvedBy?: string | null
  date: DateOnly
  distribution: 'EVEN' | 'FROM_LAST'
  makeRule?: boolean
}

/** إضافة خصم لاحق على ذمة أو نوع رسوم أو كامل الحساب (§5.4). */
export async function addDiscount(tx: Tx, ctx: Ctx, input: AddDiscountInput) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const student = await tx.student.findUnique({ where: { id: input.studentId } })
  if (!student) throw new BusinessError('الطالب غير موجود')
  await assertYearOpen(tx, input.academicYearId)
  const value = D(input.value)
  if (!value.greaterThan(0)) throw new BusinessError('قيمة الخصم يجب أن تكون أكبر من صفر', { value: 'أكبر من صفر' })
  if (input.method === 'PERCENT' && value.greaterThan(100)) throw new BusinessError('نسبة الخصم لا تتجاوز 100%', { value: 'حتى 100%' })

  const where =
    input.scope === 'CHARGE'
      ? { id: input.chargeId ?? -1, studentId: input.studentId, status: 'ACTIVE' as const }
      : input.scope === 'CHARGE_TYPE'
        ? { studentId: input.studentId, academicYearId: input.academicYearId, chargeTypeId: input.chargeTypeId ?? -1, status: 'ACTIVE' as const }
        : { studentId: input.studentId, academicYearId: input.academicYearId, status: 'ACTIVE' as const }
  const charges = await tx.charge.findMany({ where, include: { chargeType: true }, orderBy: { date: 'asc' } })
  if (charges.length === 0) throw new BusinessError('لا توجد ذمم مطابقة لتطبيق الخصم عليها')

  const targets = charges
    .map((c) => ({ charge: c, discountable: D(c.netAmount).minus(D(c.paidAmount)) }))
    .filter((t) => t.discountable.greaterThan(0))
  if (targets.length === 0) {
    throw new BusinessError('كل الذمم المطابقة مدفوعة بالكامل. لإرجاع مبلغ للطالب استخدم «إلغاء الذمة» ثم «مرتجع».')
  }

  let applications: { chargeId: number; base: Decimal; amount: Decimal }[]
  const notes: string[] = []
  if (input.method === 'PERCENT') {
    applications = targets.map((t) => {
      const wanted = percentOf(t.charge.grossAmount, value, decimals)
      if (wanted.greaterThan(t.discountable)) {
        if (input.scope === 'CHARGE') {
          throw new BusinessError(
            `الخصم (${wanted.toFixed(decimals)}) أكبر من المتبقي غير المدفوع على الذمة (${t.discountable.toFixed(decimals)})`,
            { value: 'أكبر من المتبقي' },
          )
        }
        notes.push(`${t.charge.chargeType.name}: طُبق ${t.discountable.toFixed(decimals)} بدل ${wanted.toFixed(decimals)} بسبب مدفوعات سابقة`)
      }
      return { chargeId: t.charge.id, base: D(t.charge.grossAmount), amount: min(wanted, t.discountable) }
    })
  } else {
    const total = round(value, decimals)
    const available = sum(targets.map((t) => t.discountable))
    if (total.greaterThan(available)) {
      throw new BusinessError(`الخصم أكبر من المتبقي غير المدفوع (${available.toFixed(decimals)})`, { value: 'أكبر من المتبقي' })
    }
    const shares = distributeProportional(total, targets.map((t) => t.discountable), decimals)
    applications = targets.map((t, i) => ({ chargeId: t.charge.id, base: D(t.charge.grossAmount), amount: shares[i] }))
  }
  applications = applications.filter((a) => a.amount.greaterThan(0))
  if (applications.length === 0) throw new BusinessError('قيمة الخصم بعد التقريب صفر')

  const discount = await recordDiscount(tx, ctx, {
    studentId: student.id,
    studentName: student.fullName,
    academicYearId: input.academicYearId,
    date: input.date,
    scope: input.scope,
    chargeId: input.scope === 'CHARGE' ? (input.chargeId ?? null) : null,
    chargeTypeId: input.scope === 'CHARGE_TYPE' ? (input.chargeTypeId ?? null) : null,
    spec: {
      method: input.method,
      value: input.value,
      discountTypeId: input.discountTypeId,
      reason: input.reason + (notes.length ? ` (${notes.join('؛ ')})` : ''),
      approvedBy: input.approvedBy,
    },
    applications,
    distribution: input.distribution,
    chargeLabel: input.scope === 'CHARGE' ? charges[0].chargeType.name : input.scope === 'CHARGE_TYPE' ? charges[0].chargeType.name : 'كامل الحساب',
  })

  for (const a of applications) {
    await recomputeCharge(tx, a.chargeId)
    await redistributeInstallments(tx, a.chargeId, decimals, input.distribution)
  }

  if (input.makeRule && input.scope !== 'CHARGE') {
    await tx.studentDiscountRule.create({
      data: {
        studentId: student.id,
        discountTypeId: input.discountTypeId ?? null,
        chargeTypeId: input.scope === 'CHARGE_TYPE' ? (input.chargeTypeId ?? null) : null,
        academicYearId: null,
        method: input.method,
        value: toDb(input.value),
        reason: input.reason,
        approvedBy: input.approvedBy ?? null,
        createdById: ctx.userId,
      },
    })
  }

  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Discount',
    entityId: discount.id,
    entityLabel: `خصم للطالب ${student.fullName}`,
    summary: `إضافة ${discount.discountType?.name ?? 'خصم'} للطالب ${student.fullName}: ${sum(applications.map((a) => a.amount)).toFixed(decimals)} — السبب: ${input.reason}${input.approvedBy ? ` — بموافقة: ${input.approvedBy}` : ''}`,
    after: { ...discount, applications: applications.map((a) => ({ chargeId: a.chargeId, amount: a.amount.toString() })) },
  })
  return discount
}

export async function cancelDiscount(tx: Tx, ctx: Ctx, discountId: number, reason: string) {
  const { finance } = await getSettings(tx)
  const discount = await tx.discount.findUnique({
    where: { id: discountId },
    include: { applications: { include: { charge: true } }, student: true, discountType: true },
  })
  if (!discount) throw new BusinessError('الخصم غير موجود')
  if (discount.status === 'CANCELLED') throw new BusinessError('الخصم ملغي مسبقًا')
  const date = await todayOf(tx)
  await tx.discount.update({
    where: { id: discountId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason },
  })
  if (discount.journalEntryId) {
    await reverseEntry(tx, ctx, discount.journalEntryId, {
      date,
      description: `إلغاء ${discount.discountType?.name ?? 'خصم'} للطالب ${discount.student.fullName} — ${reason}`,
      sourceType: 'DISCOUNT_CANCEL',
    })
  }
  for (const app of discount.applications) {
    if (app.charge.status !== 'ACTIVE') continue
    await recomputeCharge(tx, app.chargeId)
    await redistributeInstallments(tx, app.chargeId, finance.decimals, 'EVEN')
  }
  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'Discount',
    entityId: discountId,
    entityLabel: `خصم للطالب ${discount.student.fullName}`,
    summary: `إلغاء ${discount.discountType?.name ?? 'خصم'} بقيمة ${D(discount.amount).toFixed(finance.decimals)} للطالب ${discount.student.fullName} — السبب: ${reason}`,
    before: discount,
  })
}

/**
 * إلغاء ذمة (§5.10): الدفعات الموزعة عليها تتحول رصيدًا دائنًا للطالب،
 * وتُعكس قيودها وقيود خصوماتها. لا يُحذف شيء.
 */
export async function cancelCharge(tx: Tx, ctx: Ctx, chargeId: number, reason: string) {
  const { finance } = await getSettings(tx)
  const charge = await tx.charge.findUnique({
    where: { id: chargeId },
    include: { student: true, chargeType: true, installments: true, discountApplications: { include: { discount: { include: { applications: true } } } } },
  })
  if (!charge) throw new BusinessError('الذمة غير موجودة')
  if (charge.status === 'CANCELLED') throw new BusinessError('الذمة ملغاة مسبقًا')
  const date = await todayOf(tx)

  // 1) فك توزيعات الدفعات ← رصيد دائن للطالب
  const allocations = await tx.paymentAllocation.findMany({ where: { chargeId, receipt: { status: 'ACTIVE' } } })
  const movedToCredit = sum(allocations.map((a) => a.amount))
  for (const a of allocations) {
    await tx.paymentAllocation.update({ where: { id: a.id }, data: { chargeId: null, installmentId: null } })
  }

  // 2) الخصومات المرتبطة
  const discAcc = await accountIdByKey(tx, 'DISCOUNTS_ALLOWED')
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  for (const app of charge.discountApplications) {
    const d = app.discount
    if (d.status !== 'ACTIVE') continue
    const onlyThisCharge = d.applications.every((x) => x.chargeId === chargeId)
    if (onlyThisCharge) {
      await tx.discount.update({
        where: { id: d.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: `إلغاء الذمة: ${reason}` },
      })
      if (d.journalEntryId) {
        await reverseEntry(tx, ctx, d.journalEntryId, { date, description: `إلغاء خصم بسبب إلغاء الذمة — ${reason}`, sourceType: 'DISCOUNT_CANCEL' })
      }
    } else {
      await postEntry(tx, ctx, {
        date,
        description: `إلغاء جزء خصم مرتبط بذمة ملغاة (${charge.chargeType.name}) — ${charge.student.fullName}`,
        sourceType: 'DISCOUNT_CANCEL',
        sourceId: d.id,
        lines: [
          { accountId: ar, debit: app.amount, studentId: charge.studentId },
          { accountId: discAcc, credit: app.amount, studentId: charge.studentId },
        ],
      })
    }
  }

  // 3) الأقساط والذمة
  await tx.installment.updateMany({
    where: { chargeId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: `إلغاء الذمة: ${reason}` },
  })
  for (const inst of charge.installments) await recomputeInstallment(tx, inst.id)
  await tx.charge.update({
    where: { id: chargeId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: ctx.userId,
      cancelReason: reason,
      paidAmount: '0',
      paymentStatus: 'UNPAID',
    },
  })

  // 4) عكس قيد الذمة
  if (charge.journalEntryId) {
    await reverseEntry(tx, ctx, charge.journalEntryId, {
      date,
      description: `إلغاء ذمة ${charge.chargeType.name} — ${charge.student.fullName} — ${reason}`,
      sourceType: 'CHARGE_CANCEL',
    })
  }

  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'Charge',
    entityId: chargeId,
    entityLabel: `${charge.chargeType.name} — ${charge.student.fullName}`,
    summary: `إلغاء ذمة ${charge.chargeType.name} (${D(charge.grossAmount).toFixed(finance.decimals)}) للطالب ${charge.student.fullName} — السبب: ${reason}${movedToCredit.greaterThan(0) ? ` — تحوّل ${movedToCredit.toFixed(finance.decimals)} مدفوعة إلى رصيد دائن للطالب` : ''}`,
    before: charge,
  })
  return { movedToCredit: movedToCredit.toString() }
}

/** تخفيض ذمة بإلغاء أقساط غير مدفوعة (مثل الانسحاب): قيد عكسي جزئي للإيراد. */
async function reduceChargeByInstallments(tx: Tx, ctx: Ctx, chargeId: number, installmentIds: number[], reason: string, date: DateOnly) {
  const charge = await tx.charge.findUniqueOrThrow({ where: { id: chargeId }, include: { chargeType: true, student: true } })
  const insts = await tx.installment.findMany({ where: { id: { in: installmentIds }, chargeId } })
  const cut = sum(insts.map((i) => i.amount))
  if (!cut.greaterThan(0)) return ZERO
  for (const i of insts) {
    if (!D(i.paidAmount).isZero()) throw new BusinessError('لا يمكن إلغاء قسط مدفوع منه')
  }
  await tx.installment.updateMany({
    where: { id: { in: installmentIds } },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
  })
  const gross = D(charge.grossAmount).minus(cut)
  const net = D(charge.netAmount).minus(cut)
  if (gross.isNegative() || net.isNegative()) throw new BusinessError('قيمة التخفيض أكبر من الذمة')
  await tx.charge.update({ where: { id: chargeId }, data: { grossAmount: toDb(gross), netAmount: toDb(net) } })
  await recomputeCharge(tx, chargeId)
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  await postEntry(tx, ctx, {
    date,
    description: `تخفيض ذمة ${charge.chargeType.name} — ${charge.student.fullName} — ${reason}`,
    sourceType: 'CHARGE_REDUCE',
    sourceId: chargeId,
    lines: [
      { accountId: charge.chargeType.revenueAccountId, debit: cut, studentId: charge.studentId, description: reason },
      { accountId: ar, credit: cut, studentId: charge.studentId, description: `تخفيض ذمة: ${reason}` },
    ],
  })
  return cut
}

/** عند انسحاب الطالب: إلغاء الأقساط التي يستحق موعدها بعد تاريخ الانسحاب ولم يُدفع منها شيء. */
export async function cancelFutureInstallmentsForWithdrawal(tx: Tx, ctx: Ctx, studentId: number, withdrawalDate: DateOnly, reason: string) {
  const insts = await tx.installment.findMany({
    where: {
      studentId,
      status: 'UNPAID',
      dueDate: { gt: fromDateOnly(withdrawalDate) },
      charge: { status: 'ACTIVE' },
    },
  })
  const byCharge = new Map<number, number[]>()
  for (const i of insts) {
    if (!D(i.paidAmount).isZero()) continue
    byCharge.set(i.chargeId, [...(byCharge.get(i.chargeId) ?? []), i.id])
  }
  const date = await todayOf(tx)
  let total = ZERO
  for (const [chargeId, ids] of byCharge) {
    total = total.plus(await reduceChargeByInstallments(tx, ctx, chargeId, ids, `انسحاب الطالب: ${reason}`, date))
  }
  return { total: total.toString(), installments: insts.length }
}

/** إعادة جدولة الجزء غير المدفوع من الذمة (§5.13) — لا قيد محاسبي لأن الإجمالي لم يتغير. */
export async function rescheduleCharge(
  tx: Tx,
  ctx: Ctx,
  chargeId: number,
  input: { count: number; firstDueDate: DateOnly; dueDay?: number | null; schedule?: { dueDate: DateOnly; amount: string }[] | null },
) {
  const { finance } = await getSettings(tx)
  const charge = await tx.charge.findUnique({
    where: { id: chargeId },
    include: { installments: { orderBy: { number: 'asc' } }, chargeType: true, student: true },
  })
  if (!charge) throw new BusinessError('الذمة غير موجودة')
  if (charge.status !== 'ACTIVE') throw new BusinessError('لا يمكن جدولة ذمة ملغاة')
  const active = charge.installments.filter((i) => i.status !== 'CANCELLED')
  const before = active.map((i) => ({ number: i.number, dueDate: toDateOnly(i.dueDate), amount: i.amount.toString(), paid: i.paidAmount.toString() }))

  // الأقساط المدفوع منها: تُغلق على ما دُفع منها
  let keptTotal = ZERO
  for (const i of active) {
    const paid = D(i.paidAmount)
    if (paid.greaterThan(0)) {
      if (!paid.equals(D(i.amount))) {
        await tx.installment.update({ where: { id: i.id }, data: { amount: toDb(paid) } })
        await recomputeInstallment(tx, i.id)
      }
      keptTotal = keptTotal.plus(paid)
    }
  }
  const remaining = D(charge.netAmount).minus(keptTotal)
  if (!remaining.greaterThan(0)) throw new BusinessError('لا يوجد مبلغ غير مدفوع لإعادة جدولته')

  // الأقساط الحرة القديمة تُلغى (ولا تُحذف)
  const freeIds = active.filter((i) => D(i.paidAmount).isZero()).map((i) => i.id)
  if (freeIds.length) {
    await tx.installment.updateMany({
      where: { id: { in: freeIds } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'إعادة جدولة' },
    })
  }

  let schedule: ScheduleLine[]
  if (input.schedule && input.schedule.length > 0) {
    validateCustomSchedule(input.schedule, remaining)
    schedule = input.schedule.map((l) => ({ dueDate: l.dueDate, amount: round(l.amount, finance.decimals) }))
  } else {
    schedule = generateSchedule(remaining, input.count, input.firstDueDate, finance.decimals, input.dueDay)
  }
  const maxNumber = Math.max(0, ...charge.installments.map((i) => i.number))
  await tx.installment.createMany({
    data: schedule.map((l, i) => ({
      chargeId,
      studentId: charge.studentId,
      academicYearId: charge.academicYearId,
      number: maxNumber + i + 1,
      dueDate: fromDateOnly(l.dueDate),
      amount: toDb(l.amount),
      status: paymentStatusOf(l.amount, ZERO),
    })),
  })
  const activeCount = await tx.installment.count({ where: { chargeId, status: { not: 'CANCELLED' } } })
  await tx.charge.update({ where: { id: chargeId }, data: { isInstallment: activeCount > 1, installmentCount: activeCount } })
  await recomputeCharge(tx, chargeId)
  await audit(tx, ctx, {
    action: 'reschedule',
    entityType: 'Charge',
    entityId: chargeId,
    entityLabel: `${charge.chargeType.name} — ${charge.student.fullName}`,
    summary: `إعادة جدولة ${remaining.toFixed(finance.decimals)} من ذمة ${charge.chargeType.name} للطالب ${charge.student.fullName} على ${schedule.length} أقساط`,
    before,
    after: schedule.map((l) => ({ dueDate: l.dueDate, amount: l.amount.toString() })),
  })
}

// ---------------------------------------------------------------------
// الرسوم المقررة والإصدار الجماعي
// ---------------------------------------------------------------------

export interface BulkChargeInput {
  academicYearId: number
  chargeTypeId: number
  gradeIds: number[]
  studentIds?: number[] | null
  useFeePlan: boolean
  amount?: string | null
  date: DateOnly
  dueDate?: DateOnly | null
  installments?: { count: number; firstDueDate: DateOnly; dueDay?: number | null } | null
  description?: string | null
  applyRules: boolean
  includeInactive?: boolean
}

export interface BulkPreviewRow {
  studentId: number
  studentName: string
  studentNumber: string
  gradeName: string
  amount: string | null
  installments: number
  skip: boolean
  skipReason: string | null
  rulesCount: number
}

export async function previewBulkCharges(client: DbOrTx, input: BulkChargeInput): Promise<BulkPreviewRow[]> {
  const enrollments = await client.enrollment.findMany({
    where: {
      academicYearId: input.academicYearId,
      ...(input.gradeIds.length ? { gradeId: { in: input.gradeIds } } : {}),
      ...(input.studentIds && input.studentIds.length ? { studentId: { in: input.studentIds } } : {}),
      student: input.includeInactive ? undefined : { status: 'ACTIVE' },
    },
    include: { student: true, grade: true },
    orderBy: [{ grade: { sortOrder: 'asc' } }, { student: { fullName: 'asc' } }],
  })
  const plans = input.useFeePlan
    ? await client.feePlan.findMany({ where: { academicYearId: input.academicYearId, chargeTypeId: input.chargeTypeId, isActive: true } })
    : []
  const existing = await client.charge.findMany({
    where: {
      academicYearId: input.academicYearId,
      chargeTypeId: input.chargeTypeId,
      status: 'ACTIVE',
      studentId: { in: enrollments.map((e) => e.studentId) },
    },
    select: { studentId: true },
  })
  const has = new Set(existing.map((e) => e.studentId))
  const rules = await client.studentDiscountRule.findMany({
    where: {
      isActive: true,
      studentId: { in: enrollments.map((e) => e.studentId) },
      AND: [
        { OR: [{ chargeTypeId: null }, { chargeTypeId: input.chargeTypeId }] },
        { OR: [{ academicYearId: null }, { academicYearId: input.academicYearId }] },
      ],
    },
    select: { studentId: true },
  })
  const ruleCount = new Map<number, number>()
  for (const r of rules) ruleCount.set(r.studentId, (ruleCount.get(r.studentId) ?? 0) + 1)

  return enrollments.map((e) => {
    const plan = plans.find((p) => p.gradeId === e.gradeId)
    const amount = input.useFeePlan ? (plan ? plan.amount.toString() : null) : (input.amount ?? null)
    const skipReason = has.has(e.studentId)
      ? 'لديه نفس الذمة في هذه السنة'
      : !amount || !D(amount).greaterThan(0)
        ? 'لا توجد رسوم مقررة لصفه'
        : null
    return {
      studentId: e.studentId,
      studentName: e.student.fullName,
      studentNumber: e.student.studentNumber,
      gradeName: e.grade.name,
      amount,
      installments: input.useFeePlan ? (plan?.installmentsCount ?? 1) : (input.installments?.count ?? 1),
      skip: !!skipReason,
      skipReason,
      rulesCount: input.applyRules ? (ruleCount.get(e.studentId) ?? 0) : 0,
    }
  })
}

export async function createBulkCharges(tx: Tx, ctx: Ctx, input: BulkChargeInput) {
  const preview = await previewBulkCharges(tx, input)
  const batchId = randomUUID()
  const plans = input.useFeePlan
    ? await tx.feePlan.findMany({ where: { academicYearId: input.academicYearId, chargeTypeId: input.chargeTypeId, isActive: true } })
    : []
  const enrollments = await tx.enrollment.findMany({
    where: { academicYearId: input.academicYearId, studentId: { in: preview.map((p) => p.studentId) } },
  })
  const year = await tx.academicYear.findUniqueOrThrow({ where: { id: input.academicYearId } })
  let created = 0
  let total = ZERO
  for (const row of preview) {
    if (row.skip || !row.amount) continue
    const gradeId = enrollments.find((e) => e.studentId === row.studentId)?.gradeId
    const plan = plans.find((p) => p.gradeId === gradeId)
    const inst = input.useFeePlan
      ? plan && plan.installmentsCount > 1
        ? {
            count: plan.installmentsCount,
            firstDueDate: plan.firstDueDate ? toDateOnly(plan.firstDueDate) : (input.installments?.firstDueDate ?? toDateOnly(year.startDate)),
            dueDay: plan.dueDay,
          }
        : null
      : input.installments && input.installments.count > 1
        ? input.installments
        : null
    await createCharge(tx, ctx, {
      studentId: row.studentId,
      chargeTypeId: input.chargeTypeId,
      academicYearId: input.academicYearId,
      date: input.date,
      dueDate: input.dueDate ?? (plan?.firstDueDate ? toDateOnly(plan.firstDueDate) : null),
      grossAmount: row.amount,
      description: input.description,
      installments: inst,
      applyRules: input.applyRules,
      bulkBatchId: batchId,
      skipAudit: true,
    })
    created++
    total = total.plus(D(row.amount))
  }
  const chargeType = await tx.chargeType.findUniqueOrThrow({ where: { id: input.chargeTypeId } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Charge',
    entityId: batchId,
    entityLabel: `إصدار جماعي: ${chargeType.name}`,
    summary: `إصدار ذمم جماعية (${chargeType.name}) لـ ${created} طالبًا بإجمالي ${total.toString()} — تم تجاوز ${preview.filter((p) => p.skip).length}`,
    after: { batchId, created, skipped: preview.filter((p) => p.skip).map((p) => ({ student: p.studentName, reason: p.skipReason })) },
  })
  return { batchId, created, skipped: preview.filter((p) => p.skip).length, total: total.toString() }
}

/** تطبيق الرسوم المقررة لصف الطالب (عند إضافة طالب جديد). */
export async function applyFeePlansToStudent(tx: Tx, ctx: Ctx, studentId: number, academicYearId: number, options?: { date?: DateOnly }) {
  const enrollment = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId } } })
  if (!enrollment) return { created: 0 }
  const plans = await tx.feePlan.findMany({
    where: { academicYearId, gradeId: enrollment.gradeId, isActive: true },
    include: { chargeType: true },
  })
  const year = await tx.academicYear.findUniqueOrThrow({ where: { id: academicYearId } })
  const today = options?.date ?? (await todayOf(tx))
  let created = 0
  for (const plan of plans) {
    const exists = await tx.charge.findFirst({ where: { studentId, academicYearId, chargeTypeId: plan.chargeTypeId, status: 'ACTIVE' } })
    if (exists || !D(plan.amount).greaterThan(0)) continue
    const firstDue = plan.firstDueDate ? toDateOnly(plan.firstDueDate) : today > toDateOnly(year.startDate) ? today : toDateOnly(year.startDate)
    await createCharge(tx, ctx, {
      studentId,
      chargeTypeId: plan.chargeTypeId,
      academicYearId,
      date: today,
      dueDate: firstDue,
      grossAmount: plan.amount.toString(),
      installments: plan.installmentsCount > 1 ? { count: plan.installmentsCount, firstDueDate: firstDue, dueDay: plan.dueDay } : null,
      applyRules: true,
    })
    created++
  }
  return { created }
}

export async function saveFeePlan(
  tx: Tx,
  ctx: Ctx,
  input: {
    id?: number | null
    academicYearId: number
    gradeId: number
    chargeTypeId: number
    amount: string
    installmentsCount: number
    firstDueDate?: DateOnly | null
    dueDay?: number | null
    notes?: string | null
  },
) {
  if (input.installmentsCount < 1 || input.installmentsCount > 60) throw new BusinessError('عدد الأقساط بين 1 و 60')
  if (input.dueDay !== null && input.dueDay !== undefined && (input.dueDay < 1 || input.dueDay > 31)) throw new BusinessError('يوم الاستحقاق بين 1 و 31')
  const data = {
    academicYearId: input.academicYearId,
    gradeId: input.gradeId,
    chargeTypeId: input.chargeTypeId,
    amount: toDb(input.amount),
    installmentsCount: input.installmentsCount,
    firstDueDate: input.firstDueDate ? fromDateOnly(input.firstDueDate) : null,
    dueDay: input.dueDay ?? null,
    notes: input.notes ?? null,
    isActive: true,
  }
  const existing = await tx.feePlan.findUnique({
    where: { academicYearId_gradeId_chargeTypeId: { academicYearId: input.academicYearId, gradeId: input.gradeId, chargeTypeId: input.chargeTypeId } },
  })
  const plan = existing
    ? await tx.feePlan.update({ where: { id: existing.id }, data })
    : await tx.feePlan.create({ data })
  await audit(tx, ctx, {
    action: existing ? 'update' : 'create',
    entityType: 'FeePlan',
    entityId: plan.id,
    before: existing,
    after: plan,
  })
  return plan
}

// ---------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------

export async function studentCharges(client: DbOrTx, studentId: number, options?: { academicYearId?: number; includeCancelled?: boolean }) {
  return client.charge.findMany({
    where: {
      studentId,
      ...(options?.academicYearId ? { academicYearId: options.academicYearId } : {}),
      ...(options?.includeCancelled ? {} : { status: 'ACTIVE' }),
    },
    include: {
      chargeType: true,
      academicYear: true,
      installments: { orderBy: [{ dueDate: 'asc' }, { number: 'asc' }] },
      createdBy: { select: { fullName: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  })
}

export async function getChargeDetails(client: DbOrTx, chargeId: number) {
  return client.charge.findUnique({
    where: { id: chargeId },
    include: {
      student: { include: { guardian: true } },
      chargeType: true,
      academicYear: true,
      createdBy: { select: { fullName: true } },
      installments: {
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        include: { allocations: { include: { receipt: { select: { id: true, number: true, date: true, status: true } } } } },
      },
      discountApplications: {
        include: { discount: { include: { discountType: true, createdBy: { select: { fullName: true } } } } },
      },
    },
  })
}

export function chargeTypesList(client: DbOrTx = db, activeOnly = true) {
  return client.chargeType.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { revenueAccount: { select: { code: true, name: true } } },
  })
}

export function discountTypesList(client: DbOrTx = db, activeOnly = true) {
  return client.discountType.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}
