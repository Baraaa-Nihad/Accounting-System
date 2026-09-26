import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { PaymentMethod, VoucherKind } from '@/generated/prisma/enums'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError, PermissionError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { resolveOpenYear } from '../years'
import { nextDocumentNumber } from '../numbering'
import { postEntry, reverseEntry } from '../ledger/posting'
import { accountIdByKey, isFreePostingAccount } from '../ledger/accounts'
import { assertSufficientBalance } from './treasury'
import { recomputeJobPaid, supplierBalance } from './parties'
import { recomputePayrollItemPaid } from './payroll'
import { D, round, sum, toDb } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'
import { PAYMENT_METHOD, VOUCHER_KIND } from '@/lib/labels'
import type Decimal from 'decimal.js'

/**
 * سندات الصرف (docs/05-workflows.md §5.11، §5.14 – §5.19)
 * كل سند: رقم تلقائي PAY-، التحقق من كفاية الرصيد، قيد مزدوج، سجل نشاط.
 */

export interface VoucherInput {
  kind: VoucherKind
  date: DateOnly
  amount: string
  paymentMethod: PaymentMethod
  cashAccountId: number
  payeeName?: string | null
  expenseAccountId?: number | null
  supplierId?: number | null
  contractorJobId?: number | null
  employeeId?: number | null
  payrollItemId?: number | null
  advanceId?: number | null
  studentId?: number | null
  partnerId?: number | null
  otherAccountId?: number | null
  cheque?: { number: string; bankName?: string | null; dueDate: DateOnly } | null
  referenceNumber?: string | null
  description?: string | null
  notes?: string | null
  allowSupplierAdvance?: boolean
  importBatchId?: number | null
}

interface Posting {
  debitAccountId: number
  party: { supplierId?: number; contractorId?: number; employeeId?: number; studentId?: number; partnerId?: number }
  payeeName: string
  label: string
  links: Partial<{
    expenseAccountId: number
    supplierId: number
    contractorId: number
    contractorJobId: number
    employeeId: number
    payrollItemId: number
    advanceId: number
    studentId: number
    partnerId: number
  }>
}

async function resolvePosting(tx: Tx, ctx: Ctx, input: VoucherInput, amount: Decimal, decimals: number): Promise<Posting> {
  switch (input.kind) {
    case 'EXPENSE': {
      const acc = await tx.account.findUnique({ where: { id: input.expenseAccountId ?? -1 } })
      if (!acc || acc.isGroup || !acc.isActive || acc.type !== 'EXPENSE') throw new BusinessError('اختر نوع المصروف', { expenseAccountId: 'اختر نوع المصروف' })
      let supplierName: string | null = null
      if (input.supplierId) supplierName = (await tx.supplier.findUnique({ where: { id: input.supplierId } }))?.name ?? null
      const payee = input.payeeName?.trim() || supplierName
      if (!payee) throw new BusinessError('اسم المستفيد مطلوب', { payeeName: 'مطلوب' })
      return {
        debitAccountId: acc.id,
        party: input.supplierId ? { supplierId: input.supplierId } : {},
        payeeName: payee,
        label: acc.name,
        links: { expenseAccountId: acc.id, ...(input.supplierId ? { supplierId: input.supplierId } : {}) },
      }
    }
    case 'SUPPLIER_PAYMENT': {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId ?? -1 } })
      if (!supplier) throw new BusinessError('اختر المورد', { supplierId: 'اختر المورد' })
      const due = await supplierBalance(tx, supplier.id)
      if (amount.greaterThan(due) && !input.allowSupplierAdvance) {
        throw new BusinessError(`المبلغ أكبر من المستحق للمورد (${due.toFixed(decimals)}). لتسجيل دفعة مقدمة فعّل خيار «دفعة مقدمة».`, { amount: 'أكبر من المستحق' })
      }
      return {
        debitAccountId: await accountIdByKey(tx, 'AP_SUPPLIERS'),
        party: { supplierId: supplier.id },
        payeeName: input.payeeName?.trim() || supplier.name,
        label: `دفعة للمورد ${supplier.name}`,
        links: { supplierId: supplier.id },
      }
    }
    case 'CONTRACTOR_PAYMENT': {
      const job = await tx.contractorJob.findUnique({ where: { id: input.contractorJobId ?? -1 }, include: { contractor: true } })
      if (!job) throw new BusinessError('اختر العمل/الاتفاق', { contractorJobId: 'اختر العمل' })
      if (job.status === 'CANCELLED') throw new BusinessError('العمل ملغي')
      await tx.$queryRaw`SELECT "id" FROM "contractor_jobs" WHERE "id" = ${job.id} FOR UPDATE`
      const remaining = D(job.agreedAmount).minus(D(job.paidAmount))
      if (amount.greaterThan(remaining)) {
        throw new BusinessError(`الدفعة أكبر من المتبقي للمتعامل على هذا العمل (${remaining.toFixed(decimals)}). عدّل قيمة الاتفاق أولًا إذا زادت.`, { amount: 'أكبر من المتبقي' })
      }
      return {
        debitAccountId: await accountIdByKey(tx, 'AP_CONTRACTORS'),
        party: { contractorId: job.contractorId },
        payeeName: input.payeeName?.trim() || job.contractor.name,
        label: `دفعة عن «${job.description}» — ${job.contractor.name}`,
        links: { contractorId: job.contractorId, contractorJobId: job.id },
      }
    }
    case 'SALARY': {
      const item = await tx.payrollItem.findUnique({ where: { id: input.payrollItemId ?? -1 }, include: { employee: true, payrollRun: true } })
      if (!item) throw new BusinessError('بند الراتب غير موجود')
      if (item.payrollRun.status !== 'APPROVED') throw new BusinessError('لا يمكن صرف راتب من مسير غير معتمد')
      await tx.$queryRaw`SELECT "id" FROM "payroll_items" WHERE "id" = ${item.id} FOR UPDATE`
      const remaining = D(item.netPay).minus(D(item.paidAmount))
      if (amount.greaterThan(remaining)) throw new BusinessError(`المبلغ أكبر من المتبقي من راتب ${item.employee.fullName} (${remaining.toFixed(decimals)})`)
      return {
        debitAccountId: await accountIdByKey(tx, 'SALARIES_PAYABLE'),
        party: { employeeId: item.employeeId },
        payeeName: item.employee.fullName,
        label: `راتب شهر ${item.payrollRun.month}/${item.payrollRun.year} — ${item.employee.fullName}`,
        links: { employeeId: item.employeeId, payrollItemId: item.id },
      }
    }
    case 'ADVANCE': {
      const adv = await tx.employeeAdvance.findUnique({ where: { id: input.advanceId ?? -1 }, include: { employee: true } })
      if (!adv) throw new BusinessError('السلفة غير موجودة')
      return {
        debitAccountId: await accountIdByKey(tx, 'EMPLOYEE_ADVANCES'),
        party: { employeeId: adv.employeeId },
        payeeName: adv.employee.fullName,
        label: `سلفة للموظف ${adv.employee.fullName}`,
        links: { employeeId: adv.employeeId, advanceId: adv.id },
      }
    }
    case 'STUDENT_REFUND': {
      const student = await tx.student.findUnique({ where: { id: input.studentId ?? -1 }, include: { guardian: true } })
      if (!student) throw new BusinessError('اختر الطالب', { studentId: 'اختر الطالب' })
      return {
        debitAccountId: await accountIdByKey(tx, 'AR_STUDENTS'),
        party: { studentId: student.id },
        payeeName: input.payeeName?.trim() || student.guardian?.name || student.fullName,
        label: `مرتجع للطالب ${student.fullName}`,
        links: { studentId: student.id },
      }
    }
    case 'PARTNER_WITHDRAWAL': {
      const partner = await tx.partner.findUnique({ where: { id: input.partnerId ?? -1 } })
      if (!partner || !partner.drawingsAccountId) throw new BusinessError('اختر الشريك', { partnerId: 'اختر الشريك' })
      return {
        debitAccountId: partner.drawingsAccountId,
        party: { partnerId: partner.id },
        payeeName: partner.name,
        label: `سحب الشريك ${partner.name}`,
        links: { partnerId: partner.id },
      }
    }
    case 'OTHER': {
      if (!ctx.permissions.has('accounting.manage')) throw new PermissionError('الصرف على حساب محاسبي مباشر يتطلب صلاحية المحاسبة العامة')
      const acc = await tx.account.findUnique({ where: { id: input.otherAccountId ?? -1 } })
      if (!acc || !(await isFreePostingAccount(tx, acc.id))) {
        throw new BusinessError('اختر حسابًا صالحًا. حسابات الطلاب والموردين والمقاولين والرواتب والصناديق تُستخدم من شاشاتها.', { otherAccountId: 'اختر الحساب' })
      }
      if (!input.payeeName?.trim()) throw new BusinessError('اسم المستفيد مطلوب', { payeeName: 'مطلوب' })
      return { debitAccountId: acc.id, party: {}, payeeName: input.payeeName.trim(), label: acc.name, links: { expenseAccountId: acc.id } }
    }
  }
}

/** استهلاك الرصيد الدائن للطالب عند المرتجع (ربط صفوف التوزيع بسند الصرف). */
async function consumeStudentCredit(tx: Tx, studentId: number, voucherId: number, amount: Decimal, decimals: number) {
  const credits = await tx.paymentAllocation.findMany({
    where: { studentId, installmentId: null, refundVoucherId: null, receipt: { status: 'ACTIVE' } },
    include: { receipt: true },
    orderBy: [{ receipt: { date: 'desc' } }, { id: 'desc' }],
  })
  const available = sum(credits.map((c) => c.amount))
  if (amount.greaterThan(available)) {
    throw new BusinessError(
      `المبلغ أكبر من الرصيد الدائن للطالب (${available.toFixed(decimals)}). لإرجاع مبلغ مدفوع عن ذمة، ألغِ الذمة أولًا فيتحول المدفوع إلى رصيد دائن.`,
      { amount: 'أكبر من الرصيد الدائن' },
    )
  }
  let need = amount
  for (const c of credits) {
    if (!need.greaterThan(0)) break
    const amt = D(c.amount)
    if (amt.lessThanOrEqualTo(need)) {
      await tx.paymentAllocation.update({ where: { id: c.id }, data: { refundVoucherId: voucherId } })
      need = need.minus(amt)
    } else {
      await tx.paymentAllocation.update({ where: { id: c.id }, data: { amount: toDb(amt.minus(need)) } })
      await tx.paymentAllocation.create({ data: { receiptId: c.receiptId, studentId, refundVoucherId: voucherId, amount: toDb(need) } })
      need = D(0)
    }
  }
}

export async function createVoucher(tx: Tx, ctx: Ctx, input: VoucherInput) {
  const { finance } = await getSettings(tx)
  const decimals = finance.decimals
  const amount = round(input.amount, decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  const year = await resolveOpenYear(tx, input.date)
  const posting = await resolvePosting(tx, ctx, input, amount, decimals)
  const cash = await assertSufficientBalance(tx, input.cashAccountId, amount)
  if (input.paymentMethod === 'CHEQUE') {
    if (cash.type !== 'BANK') throw new BusinessError('الشيك يُصرف من حساب بنكي', { cashAccountId: 'اختر حسابًا بنكيًا' })
    if (!input.cheque?.number || !input.cheque.dueDate) throw new BusinessError('بيانات الشيك مطلوبة', { 'cheque.number': 'رقم الشيك مطلوب' })
  }
  const number = await nextDocumentNumber(tx, 'voucher', input.date)
  const voucher = await tx.paymentVoucher.create({
    data: {
      number,
      kind: input.kind,
      date: fromDateOnly(input.date),
      academicYearId: year.id,
      payeeName: posting.payeeName,
      amount: toDb(amount),
      paymentMethod: input.paymentMethod,
      cashAccountId: cash.id,
      ...posting.links,
      referenceNumber: input.referenceNumber ?? null,
      description: input.description ?? null,
      notes: input.notes ?? null,
      importBatchId: input.importBatchId ?? null,
      createdById: ctx.userId,
    },
  })
  const desc = `سند صرف ${number} — ${posting.label} — ${posting.payeeName}${input.description ? ` — ${input.description}` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: desc,
    sourceType: 'VOUCHER',
    sourceId: voucher.id,
    lines: [
      { accountId: posting.debitAccountId, debit: amount, ...posting.party, description: desc },
      { accountId: cash.glAccountId, credit: amount, description: `${desc} (${PAYMENT_METHOD[input.paymentMethod]})` },
    ],
  })
  await tx.paymentVoucher.update({ where: { id: voucher.id }, data: { journalEntryId: entry.id } })

  if (input.kind === 'CONTRACTOR_PAYMENT' && posting.links.contractorJobId) await recomputeJobPaid(tx, posting.links.contractorJobId)
  if (input.kind === 'SALARY' && posting.links.payrollItemId) await recomputePayrollItemPaid(tx, posting.links.payrollItemId)
  if (input.kind === 'STUDENT_REFUND' && posting.links.studentId) await consumeStudentCredit(tx, posting.links.studentId, voucher.id, amount, decimals)
  if (input.paymentMethod === 'CHEQUE' && input.cheque) {
    await tx.cheque.create({
      data: {
        direction: 'OUTGOING',
        number: input.cheque.number,
        bankName: input.cheque.bankName ?? cash.bankName ?? null,
        dueDate: fromDateOnly(input.cheque.dueDate),
        amount: toDb(amount),
        partyName: posting.payeeName,
        status: 'ISSUED',
        voucherId: voucher.id,
        depositAccountId: cash.id,
      },
    })
  }
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'PaymentVoucher',
    entityId: voucher.id,
    entityLabel: `سند صرف ${number}`,
    summary: `سند صرف ${number} (${VOUCHER_KIND[input.kind]}) بمبلغ ${amount.toFixed(decimals)} إلى ${posting.payeeName} من ${cash.name}`,
    after: voucher,
  })
  return tx.paymentVoucher.findUniqueOrThrow({ where: { id: voucher.id } })
}

export async function cancelVoucher(tx: Tx, ctx: Ctx, voucherId: number, reason: string) {
  const { finance } = await getSettings(tx)
  const v = await tx.paymentVoucher.findUnique({ where: { id: voucherId }, include: { cheque: true, advance: { include: { deductions: true } } } })
  if (!v) throw new BusinessError('السند غير موجود')
  if (v.status === 'CANCELLED') throw new BusinessError('السند ملغي مسبقًا')
  if (v.kind === 'ADVANCE' && v.advance && v.advance.deductions.length > 0) {
    throw new BusinessError('تم خصم أقساط من هذه السلفة في الرواتب، لا يمكن إلغاء سند صرفها')
  }
  const date = await todayOf(tx)
  await tx.paymentVoucher.update({
    where: { id: voucherId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason },
  })
  const rev = v.journalEntryId
    ? await reverseEntry(tx, ctx, v.journalEntryId, { date, description: `إلغاء سند صرف ${v.number} — ${reason}`, sourceType: 'VOUCHER_CANCEL' })
    : null
  await tx.paymentVoucher.update({ where: { id: voucherId }, data: { reversalEntryId: rev?.id ?? null } })
  if (v.contractorJobId) await recomputeJobPaid(tx, v.contractorJobId)
  if (v.payrollItemId) await recomputePayrollItemPaid(tx, v.payrollItemId)
  if (v.kind === 'STUDENT_REFUND') {
    await tx.paymentAllocation.updateMany({ where: { refundVoucherId: voucherId }, data: { refundVoucherId: null } })
  }
  if (v.kind === 'ADVANCE' && v.advanceId) {
    await tx.employeeAdvance.update({ where: { id: v.advanceId }, data: { status: 'CANCELLED' } })
  }
  if (v.cheque) await tx.cheque.update({ where: { id: v.cheque.id }, data: { status: 'CANCELLED' } })
  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'PaymentVoucher',
    entityId: voucherId,
    entityLabel: `سند صرف ${v.number}`,
    summary: `إلغاء سند صرف ${v.number} بقيمة ${D(v.amount).toFixed(finance.decimals)} — السبب: ${reason}`,
    before: v,
  })
}

// ---------------------------------------------------------------------
// القراءة
// ---------------------------------------------------------------------

export interface VoucherFilters {
  q?: string
  kind?: string
  from?: DateOnly
  to?: DateOnly
  method?: string
  status?: string
  userId?: number
  cashAccountId?: number
  expenseAccountId?: number
  supplierId?: number
  contractorId?: number
  employeeId?: number
  minAmount?: string
  maxAmount?: string
  page?: number
  pageSize?: number
}

export function vouchersWhere(f: VoucherFilters): Prisma.PaymentVoucherWhereInput {
  const and: Prisma.PaymentVoucherWhereInput[] = []
  if (f.q) {
    const q = f.q.trim()
    and.push({
      OR: [
        { number: { contains: q.toUpperCase(), mode: 'insensitive' } },
        { payeeName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { referenceNumber: { contains: q, mode: 'insensitive' } },
      ],
    })
  }
  if (f.kind) and.push({ kind: f.kind as VoucherKind })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  if (f.method) and.push({ paymentMethod: f.method as PaymentMethod })
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.userId) and.push({ createdById: f.userId })
  if (f.cashAccountId) and.push({ cashAccountId: f.cashAccountId })
  if (f.expenseAccountId) and.push({ expenseAccountId: f.expenseAccountId })
  if (f.supplierId) and.push({ supplierId: f.supplierId })
  if (f.contractorId) and.push({ contractorId: f.contractorId })
  if (f.employeeId) and.push({ employeeId: f.employeeId })
  if (f.minAmount) and.push({ amount: { gte: toDb(f.minAmount) } })
  if (f.maxAmount) and.push({ amount: { lte: toDb(f.maxAmount) } })
  return and.length ? { AND: and } : {}
}

export async function listVouchers(f: VoucherFilters, client: DbOrTx = db) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 5000)
  const page = Math.max(f.page ?? 1, 1)
  const where = vouchersWhere(f)
  const [rows, total, sums] = await Promise.all([
    client.paymentVoucher.findMany({
      where,
      include: {
        cashAccount: { select: { name: true } },
        expenseAccount: { select: { name: true } },
        contractorJob: { select: { description: true } },
        createdBy: { select: { fullName: true } },
        cheque: { select: { number: true, status: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.paymentVoucher.count({ where }),
    client.paymentVoucher.aggregate({ where: { AND: [where, { status: 'ACTIVE' }] }, _sum: { amount: true } }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), activeTotal: D(sums._sum.amount).toString() }
}

export async function getVoucher(client: DbOrTx, id: number) {
  return client.paymentVoucher.findUnique({
    where: { id },
    include: {
      cashAccount: true,
      expenseAccount: true,
      supplier: true,
      contractor: true,
      contractorJob: true,
      employee: true,
      payrollItem: { include: { payrollRun: true } },
      advance: true,
      student: true,
      partner: true,
      academicYear: true,
      cheque: true,
      createdBy: { select: { fullName: true } },
      cancelledBy: { select: { fullName: true } },
    },
  })
}
