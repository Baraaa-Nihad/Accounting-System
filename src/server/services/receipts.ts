import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { PaymentMethod } from '@/generated/prisma/enums'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { resolveOpenYear } from '../years'
import { nextDocumentNumber } from '../numbering'
import { postEntry, reverseEntry, type JournalLineInput } from '../ledger/posting'
import { accountIdByKey } from '../ledger/accounts'
import { recomputeCharge, recomputeInstallment } from './installments'
import { assertBoxAllowed } from './treasury'
import { D, round, sum, toDb, ZERO } from '@/lib/money'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import { PAYMENT_METHOD } from '@/lib/labels'
import type Decimal from 'decimal.js'

/**
 * سندات القبض (docs/05-workflows.md §5.5 – §5.9)
 * القاعدة: مجموع توزيعات السند = مبلغه. التوزيع بلا قسط = رصيد دائن للطالب.
 */

export interface AllocationInput {
  installmentId: number
  amount: string
}

export interface ChequeInput {
  number: string
  bankName?: string | null
  dueDate: DateOnly
  drawerName?: string | null
  /** إيداع مباشر في بنك (بدل حافظة الشيكات) */
  depositToAccountId?: number | null
}

export interface StudentReceiptInput {
  kind: 'STUDENT' | 'FAMILY'
  studentId?: number | null
  guardianId?: number | null
  date: DateOnly
  amount: string
  paymentMethod: PaymentMethod
  cashAccountId?: number | null
  cheque?: ChequeInput | null
  payerName?: string | null
  referenceNumber?: string | null
  description?: string | null
  notes?: string | null
  allocations?: AllocationInput[] | null
  creditStudentId?: number | null
  confirmCredit?: boolean
  importBatchId?: number | null
}

export interface OpenInstallment {
  id: number
  chargeId: number
  studentId: number
  studentName: string
  chargeTypeName: string
  chargeDescription: string | null
  yearName: string
  number: number
  installmentCount: number
  dueDate: DateOnly
  amount: string
  paid: string
  remaining: string
}

/** الأقساط المفتوحة (غير المدفوعة بالكامل) مرتبة: الأقدم استحقاقًا أولًا. */
export async function openInstallments(client: DbOrTx, studentIds: number[]): Promise<OpenInstallment[]> {
  if (studentIds.length === 0) return []
  const rows = await client.installment.findMany({
    where: { studentId: { in: studentIds }, status: { in: ['UNPAID', 'PARTIAL'] }, charge: { status: 'ACTIVE' } },
    include: { charge: { include: { chargeType: true, academicYear: true } }, student: { select: { fullName: true } } },
    orderBy: [{ dueDate: 'asc' }, { charge: { date: 'asc' } }, { chargeId: 'asc' }, { number: 'asc' }],
  })
  return rows
    .map((i) => ({
      id: i.id,
      chargeId: i.chargeId,
      studentId: i.studentId,
      studentName: i.student.fullName,
      chargeTypeName: i.charge.chargeType.name,
      chargeDescription: i.charge.description,
      yearName: i.charge.academicYear.name,
      number: i.number,
      installmentCount: i.charge.installmentCount,
      dueDate: toDateOnly(i.dueDate),
      amount: i.amount.toString(),
      paid: i.paidAmount.toString(),
      remaining: D(i.amount).minus(D(i.paidAmount)).toString(),
    }))
    .filter((i) => D(i.remaining).greaterThan(0))
}

/** قفل صفوف الأقساط حتى نهاية المعاملة (منع التوزيع المزدوج عند التزامن). */
async function lockInstallments(tx: Tx, ids: number[]) {
  if (ids.length === 0) return
  await tx.$queryRaw`SELECT "id" FROM "installments" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`
}

/** التوزيع التلقائي: الأقدم استحقاقًا أولًا. */
export function autoAllocate(open: OpenInstallment[], amount: Decimal): { installmentId: number; amount: Decimal }[] {
  let left = amount
  const result: { installmentId: number; amount: Decimal }[] = []
  for (const inst of open) {
    if (!left.greaterThan(0)) break
    const take = Decimal_min(D(inst.remaining), left)
    if (take.greaterThan(0)) {
      result.push({ installmentId: inst.id, amount: take })
      left = left.minus(take)
    }
  }
  return result
}

function Decimal_min(a: Decimal, b: Decimal) {
  return a.lessThan(b) ? a : b
}

/** الحساب المدين في قيد القبض حسب طريقة الدفع. */
async function debitAccountFor(tx: Tx, ctx: Ctx, input: { paymentMethod: PaymentMethod; cashAccountId?: number | null; cheque?: ChequeInput | null }) {
  if (input.paymentMethod === 'CHEQUE') {
    if (!input.cheque?.number || !input.cheque.dueDate) {
      throw new BusinessError('بيانات الشيك مطلوبة (رقم الشيك وتاريخ الاستحقاق)', { 'cheque.number': 'رقم الشيك مطلوب' })
    }
    if (input.cheque.depositToAccountId) {
      const bank = await tx.cashAccount.findUnique({ where: { id: input.cheque.depositToAccountId } })
      if (!bank || !bank.isActive) throw new BusinessError('الحساب البنكي المختار غير متاح')
      await assertBoxAllowed(tx, ctx, bank.id)
      return { accountId: bank.glAccountId, cashAccountId: bank.id, chequeStatus: 'CLEARED' as const }
    }
    return { accountId: await accountIdByKey(tx, 'CHEQUES_UNDER_COLLECTION'), cashAccountId: null, chequeStatus: 'IN_PORTFOLIO' as const }
  }
  if (!input.cashAccountId) throw new BusinessError('اختر الصندوق أو الحساب البنكي المستلم', { cashAccountId: 'مطلوب' })
  const ca = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId } })
  if (!ca || !ca.isActive) throw new BusinessError('الصندوق/الحساب المختار غير متاح', { cashAccountId: 'غير متاح' })
  await assertBoxAllowed(tx, ctx, ca.id)
  return { accountId: ca.glAccountId, cashAccountId: ca.id, chequeStatus: null }
}

export async function createStudentReceipt(tx: Tx, ctx: Ctx, input: StudentReceiptInput) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const amount = round(input.amount, decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  const year = await resolveOpenYear(tx, input.date)

  // الطلاب المعنيون
  let students: { id: number; fullName: string; guardianId: number | null }[]
  let guardian: { id: number; name: string } | null = null
  if (input.kind === 'STUDENT') {
    const s = await tx.student.findUnique({ where: { id: input.studentId ?? -1 }, include: { guardian: true } })
    if (!s) throw new BusinessError('الطالب غير موجود', { studentId: 'اختر الطالب' })
    students = [s]
    guardian = s.guardian
  } else {
    const g = await tx.guardian.findUnique({ where: { id: input.guardianId ?? -1 }, include: { students: { orderBy: { id: 'asc' } } } })
    if (!g) throw new BusinessError('ولي الأمر غير موجود')
    if (g.students.length === 0) throw new BusinessError('لا يوجد أبناء مسجلون لولي الأمر هذا')
    students = g.students
    guardian = g
  }
  const studentIds = students.map((s) => s.id)

  // التوزيع
  let planned: { installmentId: number; amount: Decimal }[]
  const open = await openInstallments(tx, studentIds)
  if (input.allocations && input.allocations.length > 0) {
    planned = input.allocations
      .map((a) => ({ installmentId: a.installmentId, amount: round(a.amount, decimals) }))
      .filter((a) => a.amount.greaterThan(0))
    await lockInstallments(tx, planned.map((p) => p.installmentId))
    const fresh = new Map((await openInstallments(tx, studentIds)).map((i) => [i.id, i]))
    for (const p of planned) {
      const inst = fresh.get(p.installmentId)
      if (!inst) throw new BusinessError('أحد الأقساط المختارة غير متاح (مدفوع أو ملغي أو لا يخص الطالب)')
      if (p.amount.greaterThan(D(inst.remaining))) {
        throw new BusinessError(`المبلغ الموزع على ${inst.chargeTypeName} (القسط ${inst.number}) أكبر من المتبقي عليه (${D(inst.remaining).toFixed(decimals)})`)
      }
    }
  } else {
    await lockInstallments(tx, open.map((o) => o.id))
    planned = autoAllocate(await openInstallments(tx, studentIds), amount)
  }
  const allocated = sum(planned.map((p) => p.amount))
  if (allocated.greaterThan(amount)) throw new BusinessError('مجموع التوزيع أكبر من مبلغ الدفعة')
  const leftover = amount.minus(allocated)
  let creditStudentId: number | null = null
  if (leftover.greaterThan(0)) {
    if (!input.confirmCredit) {
      throw new BusinessError(
        `المبلغ أكبر من المستحق الموزع بـ ${leftover.toFixed(decimals)}. سيُسجل الفرق رصيدًا دائنًا للطالب يمكن استخدامه لاحقًا.`,
        { _credit: leftover.toFixed(decimals) },
      )
    }
    creditStudentId = input.kind === 'STUDENT' ? students[0].id : (input.creditStudentId ?? students[0].id)
    if (!studentIds.includes(creditStudentId)) throw new BusinessError('الطالب المختار للرصيد الدائن ليس من أبناء ولي الأمر')
  }

  const debit = await debitAccountFor(tx, ctx, input)
  const number = await nextDocumentNumber(tx, 'receipt', input.date)
  const instMap = new Map(open.map((o) => [o.id, o]))
  const payerName =
    input.payerName?.trim() || (guardian ? guardian.name : students[0].fullName)

  const receipt = await tx.receipt.create({
    data: {
      number,
      kind: input.kind,
      date: fromDateOnly(input.date),
      academicYearId: year.id,
      payerName,
      studentId: input.kind === 'STUDENT' ? students[0].id : null,
      guardianId: guardian?.id ?? null,
      amount: toDb(amount),
      paymentMethod: input.paymentMethod,
      cashAccountId: debit.cashAccountId,
      referenceNumber: input.referenceNumber ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      importBatchId: input.importBatchId ?? null,
      createdById: ctx.userId,
    },
  })

  // صفوف التوزيع
  const installments = await tx.installment.findMany({ where: { id: { in: planned.map((p) => p.installmentId) } } })
  const instById = new Map(installments.map((i) => [i.id, i]))
  for (const p of planned) {
    const inst = instById.get(p.installmentId)!
    await tx.paymentAllocation.create({
      data: { receiptId: receipt.id, studentId: inst.studentId, chargeId: inst.chargeId, installmentId: inst.id, amount: toDb(p.amount) },
    })
  }
  if (leftover.greaterThan(0) && creditStudentId) {
    await tx.paymentAllocation.create({ data: { receiptId: receipt.id, studentId: creditStudentId, amount: toDb(leftover) } })
  }
  for (const inst of installments) await recomputeInstallment(tx, inst.id)
  for (const chargeId of new Set(installments.map((i) => i.chargeId))) await recomputeCharge(tx, chargeId)

  // القيد: من الصندوق/البنك/حافظة الشيكات إلى ذمم الطلاب (سطر لكل طالب)
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  const perStudent = new Map<number, Decimal>()
  for (const p of planned) {
    const sid = instById.get(p.installmentId)!.studentId
    perStudent.set(sid, (perStudent.get(sid) ?? ZERO).plus(p.amount))
  }
  if (leftover.greaterThan(0) && creditStudentId) perStudent.set(creditStudentId, (perStudent.get(creditStudentId) ?? ZERO).plus(leftover))
  const methodText = PAYMENT_METHOD[input.paymentMethod]
  const lines: JournalLineInput[] = [
    { accountId: debit.accountId, debit: amount, description: `سند قبض ${number} — ${payerName} (${methodText})` },
  ]
  for (const [sid, amt] of perStudent) {
    const parts = planned
      .filter((p) => instById.get(p.installmentId)!.studentId === sid)
      .map((p) => {
        const o = instMap.get(p.installmentId)
        return o ? `${o.chargeTypeName}${o.installmentCount > 1 ? ` ق${o.number}` : ''}` : ''
      })
      .filter(Boolean)
    lines.push({
      accountId: ar,
      credit: amt,
      studentId: sid,
      description: `دفعة — سند قبض ${number} (${methodText})${parts.length ? `: ${[...new Set(parts)].join('، ')}` : ''}${sid === creditStudentId && leftover.greaterThan(0) ? ' + رصيد دائن' : ''}`,
    })
  }
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: `سند قبض ${number} من ${payerName}${students.length === 1 ? ` — ${students[0].fullName}` : ''}`,
    sourceType: 'RECEIPT',
    sourceId: receipt.id,
    lines,
  })
  await tx.receipt.update({ where: { id: receipt.id }, data: { journalEntryId: entry.id } })

  if (input.paymentMethod === 'CHEQUE' && input.cheque) {
    await tx.cheque.create({
      data: {
        direction: 'INCOMING',
        number: input.cheque.number,
        bankName: input.cheque.bankName ?? null,
        dueDate: fromDateOnly(input.cheque.dueDate),
        amount: toDb(amount),
        partyName: input.cheque.drawerName ?? payerName,
        status: debit.chequeStatus ?? 'IN_PORTFOLIO',
        receiptId: receipt.id,
        depositAccountId: debit.cashAccountId,
        clearedAt: debit.chequeStatus === 'CLEARED' ? fromDateOnly(input.date) : null,
      },
    })
  }

  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Receipt',
    entityId: receipt.id,
    entityLabel: `سند قبض ${number}`,
    summary: `سند قبض ${number} بمبلغ ${amount.toFixed(decimals)} من ${payerName} (${methodText})${leftover.greaterThan(0) ? ` — منه رصيد دائن ${leftover.toFixed(decimals)}` : ''}`,
    after: {
      ...receipt,
      allocations: planned.map((p) => ({ installmentId: p.installmentId, amount: p.amount.toString() })),
      credit: leftover.toString(),
    },
  })
  return tx.receipt.findUniqueOrThrow({ where: { id: receipt.id } })
}

export interface OtherReceiptInput {
  kind: 'OTHER_REVENUE' | 'PARTNER_CAPITAL'
  date: DateOnly
  amount: string
  paymentMethod: PaymentMethod
  cashAccountId?: number | null
  cheque?: ChequeInput | null
  revenueAccountId?: number | null
  partnerId?: number | null
  payerName: string
  referenceNumber?: string | null
  description?: string | null
  notes?: string | null
  importBatchId?: number | null
}

/** إيرادات أخرى (تبرعات...) أو رأس مال من شريك. */
export async function createOtherReceipt(tx: Tx, ctx: Ctx, input: OtherReceiptInput) {
  const { finance } = await getSettings(tx)
  const amount = round(input.amount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  const year = await resolveOpenYear(tx, input.date)
  let creditAccountId: number
  let partnerId: number | null = null
  let label: string
  if (input.kind === 'OTHER_REVENUE') {
    const acc = await tx.account.findUnique({ where: { id: input.revenueAccountId ?? -1 } })
    if (!acc || acc.type !== 'REVENUE' || acc.isGroup || !acc.isActive) {
      throw new BusinessError('اختر تصنيف الإيراد', { revenueAccountId: 'اختر تصنيف الإيراد' })
    }
    creditAccountId = acc.id
    label = acc.name
  } else {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId ?? -1 } })
    if (!partner || !partner.capitalAccountId) throw new BusinessError('اختر الشريك', { partnerId: 'اختر الشريك' })
    creditAccountId = partner.capitalAccountId
    partnerId = partner.id
    label = `رأس مال الشريك ${partner.name}`
  }
  const debit = await debitAccountFor(tx, ctx, input)
  const number = await nextDocumentNumber(tx, 'receipt', input.date)
  const receipt = await tx.receipt.create({
    data: {
      number,
      kind: input.kind,
      date: fromDateOnly(input.date),
      academicYearId: year.id,
      payerName: input.payerName,
      partnerId,
      amount: toDb(amount),
      paymentMethod: input.paymentMethod,
      cashAccountId: debit.cashAccountId,
      revenueAccountId: input.kind === 'OTHER_REVENUE' ? creditAccountId : null,
      referenceNumber: input.referenceNumber ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      importBatchId: input.importBatchId ?? null,
      createdById: ctx.userId,
    },
  })
  const desc = `سند قبض ${number} — ${label} — ${input.payerName}${input.description ? ` — ${input.description}` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: desc,
    sourceType: 'RECEIPT',
    sourceId: receipt.id,
    lines: [
      { accountId: debit.accountId, debit: amount, description: desc },
      { accountId: creditAccountId, credit: amount, partnerId, description: desc },
    ],
  })
  await tx.receipt.update({ where: { id: receipt.id }, data: { journalEntryId: entry.id } })
  if (input.paymentMethod === 'CHEQUE' && input.cheque) {
    await tx.cheque.create({
      data: {
        direction: 'INCOMING',
        number: input.cheque.number,
        bankName: input.cheque.bankName ?? null,
        dueDate: fromDateOnly(input.cheque.dueDate),
        amount: toDb(amount),
        partyName: input.cheque.drawerName ?? input.payerName,
        status: debit.chequeStatus ?? 'IN_PORTFOLIO',
        receiptId: receipt.id,
        depositAccountId: debit.cashAccountId,
        clearedAt: debit.chequeStatus === 'CLEARED' ? fromDateOnly(input.date) : null,
      },
    })
  }
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Receipt',
    entityId: receipt.id,
    entityLabel: `سند قبض ${number}`,
    summary: `سند قبض ${number} (${label}) بمبلغ ${amount.toFixed(finance.decimals)} من ${input.payerName}`,
    after: receipt,
  })
  return receipt
}

/** رصيد دائن افتتاحي لطالب (مبلغ له من نظام سابق) — بدون حركة نقدية. */
export async function createOpeningCredit(tx: Tx, ctx: Ctx, input: { studentId: number; date: DateOnly; amount: string; notes?: string | null; importBatchId?: number | null }) {
  const { finance } = await getSettings(tx)
  const amount = round(input.amount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر')
  const student = await tx.student.findUnique({ where: { id: input.studentId } })
  if (!student) throw new BusinessError('الطالب غير موجود')
  const year = await resolveOpenYear(tx, input.date)
  const number = await nextDocumentNumber(tx, 'opening', input.date)
  const receipt = await tx.receipt.create({
    data: {
      number,
      kind: 'OPENING_CREDIT',
      date: fromDateOnly(input.date),
      academicYearId: year.id,
      payerName: student.fullName,
      studentId: student.id,
      amount: toDb(amount),
      paymentMethod: 'OTHER',
      description: 'رصيد دائن افتتاحي',
      notes: input.notes ?? null,
      importBatchId: input.importBatchId ?? null,
      createdById: ctx.userId,
      allocations: { create: { studentId: student.id, amount: toDb(amount) } },
    },
  })
  const ar = await accountIdByKey(tx, 'AR_STUDENTS')
  const opening = await accountIdByKey(tx, 'OPENING_BALANCE')
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: `رصيد دائن افتتاحي ${number} — ${student.fullName}`,
    sourceType: 'RECEIPT',
    sourceId: receipt.id,
    lines: [
      { accountId: opening, debit: amount },
      { accountId: ar, credit: amount, studentId: student.id, description: `رصيد دائن افتتاحي ${number}` },
    ],
  })
  await tx.receipt.update({ where: { id: receipt.id }, data: { journalEntryId: entry.id } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Receipt',
    entityId: receipt.id,
    entityLabel: number,
    summary: `رصيد دائن افتتاحي ${amount.toFixed(finance.decimals)} للطالب ${student.fullName}`,
    after: receipt,
  })
  return receipt
}

/**
 * إلغاء سند قبض (§5.8): يبقى محفوظًا بحالة «ملغي»، وتتوقف توزيعاته عن الاحتساب،
 * ويُعكس قيده (وقيد تحصيل الشيك إن وُجد) بتاريخ الإلغاء.
 */
export async function cancelReceipt(tx: Tx, ctx: Ctx, receiptId: number, reason: string, options?: { bounce?: boolean; date?: DateOnly }) {
  const { finance } = await getSettings(tx)
  const receipt = await tx.receipt.findUnique({ where: { id: receiptId }, include: { allocations: true, cheque: true } })
  if (!receipt) throw new BusinessError('السند غير موجود')
  if (receipt.status === 'CANCELLED') throw new BusinessError('السند ملغي مسبقًا')
  const refunded = receipt.allocations.filter((a) => a.refundVoucherId !== null)
  if (refunded.length > 0) {
    throw new BusinessError('جزء من هذا السند رُدّ للطالب بسند صرف (مرتجع). ألغِ سند المرتجع أولًا.')
  }
  const date = options?.date ?? (await todayOf(tx))
  await tx.receipt.update({
    where: { id: receiptId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason },
  })
  const instIds = [...new Set(receipt.allocations.map((a) => a.installmentId).filter((x): x is number => x !== null))]
  await lockInstallments(tx, instIds)
  for (const id of instIds) await recomputeInstallment(tx, id)
  for (const chargeId of new Set(receipt.allocations.map((a) => a.chargeId).filter((x): x is number => x !== null))) {
    await recomputeCharge(tx, chargeId)
  }
  // شيك سبق تحصيله بقيد مستقل: نعكس التحصيل أولًا
  if (receipt.cheque?.clearingEntryId) {
    await reverseEntry(tx, ctx, receipt.cheque.clearingEntryId, { date, description: `عكس تحصيل الشيك ${receipt.cheque.number} — ${reason}`, sourceType: 'RECEIPT_CANCEL' })
  }
  let reversalId: number | null = null
  if (receipt.journalEntryId) {
    const rev = await reverseEntry(tx, ctx, receipt.journalEntryId, {
      date,
      description: `${options?.bounce ? 'شيك مرتجع' : 'إلغاء'} سند قبض ${receipt.number} — ${reason}`,
      sourceType: 'RECEIPT_CANCEL',
    })
    reversalId = rev.id
  }
  await tx.receipt.update({ where: { id: receiptId }, data: { reversalEntryId: reversalId } })
  if (receipt.cheque) {
    await tx.cheque.update({
      where: { id: receipt.cheque.id },
      data: options?.bounce
        ? { status: 'BOUNCED', bouncedAt: fromDateOnly(date), bounceReason: reason }
        : { status: 'CANCELLED' },
    })
  }
  await audit(tx, ctx, {
    action: options?.bounce ? 'bounce' : 'cancel',
    entityType: 'Receipt',
    entityId: receiptId,
    entityLabel: `سند قبض ${receipt.number}`,
    summary: `${options?.bounce ? 'تسجيل شيك مرتجع وإلغاء' : 'إلغاء'} سند قبض ${receipt.number} بقيمة ${D(receipt.amount).toFixed(finance.decimals)} — السبب: ${reason}`,
    before: receipt,
  })
}

/** تحصيل شيك من الحافظة إلى البنك. */
export async function clearCheque(tx: Tx, ctx: Ctx, chequeId: number, input: { bankAccountId: number; date: DateOnly }) {
  const cheque = await tx.cheque.findUnique({ where: { id: chequeId }, include: { receipt: true } })
  if (!cheque || cheque.direction !== 'INCOMING') throw new BusinessError('الشيك غير موجود')
  if (cheque.status !== 'IN_PORTFOLIO') throw new BusinessError('الشيك ليس في الحافظة')
  if (cheque.receipt?.status === 'CANCELLED') throw new BusinessError('سند القبض الخاص بالشيك ملغي')
  const bank = await tx.cashAccount.findUnique({ where: { id: input.bankAccountId } })
  if (!bank || !bank.isActive) throw new BusinessError('اختر الحساب البنكي')
  const portfolio = await accountIdByKey(tx, 'CHEQUES_UNDER_COLLECTION')
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: `تحصيل الشيك رقم ${cheque.number}${cheque.bankName ? ` (${cheque.bankName})` : ''} — ${cheque.partyName ?? ''}${cheque.receipt ? ` — سند ${cheque.receipt.number}` : ''}`,
    sourceType: 'CHEQUE_CLEAR',
    sourceId: cheque.receiptId,
    lines: [
      { accountId: bank.glAccountId, debit: cheque.amount },
      { accountId: portfolio, credit: cheque.amount },
    ],
  })
  await tx.cheque.update({
    where: { id: chequeId },
    data: { status: 'CLEARED', clearedAt: fromDateOnly(input.date), depositAccountId: bank.id, clearingEntryId: entry.id },
  })
  await audit(tx, ctx, {
    action: 'clear',
    entityType: 'Cheque',
    entityId: chequeId,
    entityLabel: `شيك ${cheque.number}`,
    summary: `تحصيل الشيك ${cheque.number} بقيمة ${cheque.amount.toString()} إلى ${bank.name}`,
  })
}

export async function bounceCheque(tx: Tx, ctx: Ctx, chequeId: number, reason: string) {
  const cheque = await tx.cheque.findUnique({ where: { id: chequeId } })
  if (!cheque || cheque.direction !== 'INCOMING' || !cheque.receiptId) throw new BusinessError('الشيك غير موجود')
  if (cheque.status === 'BOUNCED' || cheque.status === 'CANCELLED') throw new BusinessError('الشيك مرتجع أو ملغي مسبقًا')
  await cancelReceipt(tx, ctx, cheque.receiptId, `شيك مرتجع رقم ${cheque.number}: ${reason}`, { bounce: true })
}

/**
 * تطبيق الرصيد الدائن للطالب على ذممه المفتوحة (§5.7).
 * لا قيد محاسبي (المبلغ داخل حساب الطالب نفسه)، فقط إعادة توزيع.
 */
export async function applyStudentCredit(tx: Tx, ctx: Ctx, studentId: number, allocations?: AllocationInput[] | null) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const credits = await tx.paymentAllocation.findMany({
    where: { studentId, installmentId: null, refundVoucherId: null, receipt: { status: 'ACTIVE' } },
    include: { receipt: true },
    orderBy: [{ receipt: { date: 'asc' } }, { id: 'asc' }],
  })
  const available = sum(credits.map((c) => c.amount))
  if (!available.greaterThan(0)) throw new BusinessError('لا يوجد رصيد دائن لهذا الطالب')
  const open = await openInstallments(tx, [studentId])
  await lockInstallments(tx, open.map((o) => o.id))
  let planned =
    allocations && allocations.length
      ? allocations.map((a) => ({ installmentId: a.installmentId, amount: round(a.amount, decimals) })).filter((a) => a.amount.greaterThan(0))
      : autoAllocate(open, available)
  const openMap = new Map(open.map((o) => [o.id, o]))
  for (const p of planned) {
    const o = openMap.get(p.installmentId)
    if (!o) throw new BusinessError('قسط غير متاح للتوزيع')
    if (p.amount.greaterThan(D(o.remaining))) throw new BusinessError('المبلغ أكبر من المتبقي على القسط')
  }
  const total = sum(planned.map((p) => p.amount))
  if (total.greaterThan(available)) throw new BusinessError(`الرصيد الدائن المتاح ${available.toFixed(decimals)} فقط`)
  if (!total.greaterThan(0)) throw new BusinessError('لا توجد مستحقات لتطبيق الرصيد عليها')

  const installments = await tx.installment.findMany({ where: { id: { in: planned.map((p) => p.installmentId) } } })
  const instById = new Map(installments.map((i) => [i.id, i]))
  // استهلاك صفوف الرصيد الأقدم أولًا
  const pool = credits.map((c) => ({ id: c.id, receiptId: c.receiptId, left: D(c.amount) }))
  planned = [...planned]
  for (const p of planned) {
    let need = p.amount
    for (const c of pool) {
      if (!need.greaterThan(0)) break
      if (!c.left.greaterThan(0)) continue
      const take = c.left.lessThan(need) ? c.left : need
      c.left = c.left.minus(take)
      need = need.minus(take)
      const inst = instById.get(p.installmentId)!
      await tx.paymentAllocation.create({
        data: { receiptId: c.receiptId, studentId, chargeId: inst.chargeId, installmentId: inst.id, amount: toDb(take) },
      })
    }
  }
  for (const c of pool) {
    const original = credits.find((x) => x.id === c.id)!
    if (c.left.equals(D(original.amount))) continue
    if (c.left.isZero()) await tx.paymentAllocation.delete({ where: { id: c.id } })
    else await tx.paymentAllocation.update({ where: { id: c.id }, data: { amount: toDb(c.left) } })
  }
  for (const inst of installments) await recomputeInstallment(tx, inst.id)
  for (const chargeId of new Set(installments.map((i) => i.chargeId))) await recomputeCharge(tx, chargeId)
  const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } })
  await audit(tx, ctx, {
    action: 'allocate',
    entityType: 'Student',
    entityId: studentId,
    entityLabel: student.fullName,
    summary: `تطبيق رصيد دائن ${total.toFixed(decimals)} على ذمم الطالب ${student.fullName}`,
    after: planned.map((p) => ({ installmentId: p.installmentId, amount: p.amount.toString() })),
  })
  return { applied: total.toString() }
}

/**
 * إعادة توزيع سند قبض على الذمم (تعديل الدفعة) مع بقاء حصة كل طالب كما هي،
 * لذلك لا يتغير القيد المحاسبي.
 */
export async function reallocateReceipt(tx: Tx, ctx: Ctx, receiptId: number, allocations: AllocationInput[]) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const receipt = await tx.receipt.findUnique({ where: { id: receiptId }, include: { allocations: true } })
  if (!receipt) throw new BusinessError('السند غير موجود')
  if (receipt.status !== 'ACTIVE') throw new BusinessError('لا يمكن تعديل سند ملغي')
  if (receipt.kind !== 'STUDENT' && receipt.kind !== 'FAMILY' && receipt.kind !== 'OPENING_CREDIT') throw new BusinessError('هذا السند غير مرتبط بطلاب')
  if (receipt.allocations.some((a) => a.refundVoucherId !== null)) throw new BusinessError('جزء من السند مرتجع، لا يمكن إعادة توزيعه')
  const perStudentBefore = new Map<number, Decimal>()
  for (const a of receipt.allocations) perStudentBefore.set(a.studentId, (perStudentBefore.get(a.studentId) ?? ZERO).plus(D(a.amount)))
  const studentIds = [...perStudentBefore.keys()]

  const oldInstIds = receipt.allocations.map((a) => a.installmentId).filter((x): x is number => x !== null)
  const newInstIds = allocations.map((a) => a.installmentId)
  await lockInstallments(tx, [...new Set([...oldInstIds, ...newInstIds])])
  // المتبقي على كل قسط مع استبعاد هذا السند
  const insts = await tx.installment.findMany({ where: { id: { in: newInstIds } }, include: { charge: true } })
  const instById = new Map(insts.map((i) => [i.id, i]))
  const perStudentAfter = new Map<number, Decimal>()
  for (const a of allocations) {
    const inst = instById.get(a.installmentId)
    if (!inst || !studentIds.includes(inst.studentId) || inst.status === 'CANCELLED' || inst.charge.status !== 'ACTIVE') {
      throw new BusinessError('أحد الأقساط غير متاح لهذا السند')
    }
    const thisReceiptOnInst = sum(receipt.allocations.filter((x) => x.installmentId === inst.id).map((x) => x.amount))
    const remaining = D(inst.amount).minus(D(inst.paidAmount)).plus(thisReceiptOnInst)
    const amt = round(a.amount, decimals)
    if (amt.greaterThan(remaining)) throw new BusinessError('المبلغ أكبر من المتبقي على القسط')
    perStudentAfter.set(inst.studentId, (perStudentAfter.get(inst.studentId) ?? ZERO).plus(amt))
  }
  for (const sid of studentIds) {
    if ((perStudentAfter.get(sid) ?? ZERO).greaterThan(perStudentBefore.get(sid) ?? ZERO)) {
      throw new BusinessError('لا يمكن أن يتجاوز توزيع أي طالب حصته من السند')
    }
  }
  const before = receipt.allocations.map((a) => ({ studentId: a.studentId, installmentId: a.installmentId, amount: a.amount.toString() }))
  await tx.paymentAllocation.deleteMany({ where: { receiptId, refundVoucherId: null } })
  for (const a of allocations) {
    const inst = instById.get(a.installmentId)!
    const amt = round(a.amount, decimals)
    if (!amt.greaterThan(0)) continue
    await tx.paymentAllocation.create({ data: { receiptId, studentId: inst.studentId, chargeId: inst.chargeId, installmentId: inst.id, amount: toDb(amt) } })
  }
  for (const sid of studentIds) {
    const left = (perStudentBefore.get(sid) ?? ZERO).minus(perStudentAfter.get(sid) ?? ZERO)
    if (left.greaterThan(0)) await tx.paymentAllocation.create({ data: { receiptId, studentId: sid, amount: toDb(left) } })
  }
  const affected = [...new Set([...oldInstIds, ...newInstIds])]
  for (const id of affected) await recomputeInstallment(tx, id)
  const chargeIds = await tx.installment.findMany({ where: { id: { in: affected } }, select: { chargeId: true } })
  for (const cid of new Set(chargeIds.map((c) => c.chargeId))) await recomputeCharge(tx, cid)
  await audit(tx, ctx, {
    action: 'allocate',
    entityType: 'Receipt',
    entityId: receiptId,
    entityLabel: `سند قبض ${receipt.number}`,
    summary: `إعادة توزيع سند القبض ${receipt.number} على الذمم`,
    before,
    after: allocations,
  })
}

// ---------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------

export interface ReceiptFilters {
  q?: string
  from?: DateOnly
  to?: DateOnly
  method?: string
  status?: string
  kind?: string
  userId?: number
  cashAccountId?: number
  studentId?: number
  minAmount?: string
  maxAmount?: string
  page?: number
  pageSize?: number
}

export function receiptsWhere(f: ReceiptFilters): Prisma.ReceiptWhereInput {
  const where: Prisma.ReceiptWhereInput = {}
  const and: Prisma.ReceiptWhereInput[] = []
  if (f.q) {
    const q = f.q.trim()
    and.push({
      OR: [
        { number: { contains: q.toUpperCase(), mode: 'insensitive' } },
        { payerName: { contains: q, mode: 'insensitive' } },
        { student: { fullName: { contains: q, mode: 'insensitive' } } },
        { referenceNumber: { contains: q, mode: 'insensitive' } },
      ],
    })
  }
  if (f.from || f.to) {
    and.push({ date: { ...(f.from ? { gte: fromDateOnly(f.from) } : {}), ...(f.to ? { lte: fromDateOnly(f.to) } : {}) } })
  }
  if (f.method) and.push({ paymentMethod: f.method as PaymentMethod })
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.kind) and.push({ kind: f.kind as Prisma.ReceiptWhereInput['kind'] })
  if (f.userId) and.push({ createdById: f.userId })
  if (f.cashAccountId) and.push({ cashAccountId: f.cashAccountId })
  if (f.studentId) and.push({ OR: [{ studentId: f.studentId }, { allocations: { some: { studentId: f.studentId } } }] })
  if (f.minAmount) and.push({ amount: { gte: toDb(f.minAmount) } })
  if (f.maxAmount) and.push({ amount: { lte: toDb(f.maxAmount) } })
  if (and.length) where.AND = and
  return where
}

export async function listReceipts(f: ReceiptFilters, client: DbOrTx = db) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 500)
  const page = Math.max(f.page ?? 1, 1)
  const where = receiptsWhere(f)
  const [rows, total, sums] = await Promise.all([
    client.receipt.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true } },
        guardian: { select: { id: true, name: true } },
        cashAccount: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        cheque: { select: { status: true, number: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.receipt.count({ where }),
    client.receipt.aggregate({ where: { AND: [where, { status: 'ACTIVE' }] }, _sum: { amount: true } }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), activeTotal: D(sums._sum.amount).toString() }
}

export async function getReceipt(client: DbOrTx, id: number) {
  return client.receipt.findUnique({
    where: { id },
    include: {
      student: { include: { guardian: true } },
      guardian: true,
      partner: true,
      cashAccount: true,
      revenueAccount: true,
      academicYear: true,
      cheque: { include: { depositAccount: true } },
      createdBy: { select: { fullName: true } },
      cancelledBy: { select: { fullName: true } },
      allocations: {
        include: {
          student: { select: { id: true, fullName: true, studentNumber: true } },
          charge: { include: { chargeType: true, academicYear: true } },
          installment: true,
          refundVoucher: { select: { id: true, number: true } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })
}

/** الرصيد الدائن المتاح للطالب. */
export async function studentCredit(client: DbOrTx, studentId: number): Promise<Decimal> {
  const agg = await client.paymentAllocation.aggregate({
    where: { studentId, installmentId: null, refundVoucherId: null, receipt: { status: 'ACTIVE' } },
    _sum: { amount: true },
  })
  return D(agg._sum.amount)
}
