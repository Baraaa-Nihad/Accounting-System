import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { resolveOpenYear } from '../years'
import { nextDocumentNumber } from '../numbering'
import { postEntry, reverseEntry } from '../ledger/posting'
import { accountIdByKey } from '../ledger/accounts'
import { partyBalance } from '../ledger/balances'
import { buildSearchText, cleanPhone, prepareSearchQuery } from '@/lib/arabic'
import { D, round, toDb } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'

/**
 * الموردون والعمال/المقاولون (docs/05-workflows.md §5.15 – §5.16)
 */

// ---------------------------------------------------------------------
// الموردون
// ---------------------------------------------------------------------

export interface SupplierInput {
  name: string
  category?: string | null
  phone?: string | null
  email?: string | null
  contactPerson?: string | null
  address?: string | null
  taxNumber?: string | null
  notes?: string | null
  isActive?: boolean
}

export async function saveSupplier(tx: Tx, ctx: Ctx, input: SupplierInput & { id?: number | null; importBatchId?: number | null }) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم المورد مطلوب', { name: 'مطلوب' })
  const data = {
    name,
    category: input.category ?? null,
    phone: cleanPhone(input.phone),
    email: input.email ?? null,
    contactPerson: input.contactPerson ?? null,
    address: input.address ?? null,
    taxNumber: input.taxNumber ?? null,
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
    searchText: buildSearchText([name, input.category, input.phone, input.contactPerson]),
  }
  if (input.id) {
    const before = await tx.supplier.findUniqueOrThrow({ where: { id: input.id } })
    const after = await tx.supplier.update({ where: { id: input.id }, data })
    await audit(tx, ctx, { action: 'update', entityType: 'Supplier', entityId: after.id, entityLabel: after.name, before, after })
    return after
  }
  const dup = await tx.supplier.findFirst({ where: { name } })
  if (dup) throw new BusinessError('يوجد مورد بنفس الاسم', { name: 'مكرر' })
  const created = await tx.supplier.create({ data: { ...data, importBatchId: input.importBatchId ?? null } })
  await audit(tx, ctx, { action: 'create', entityType: 'Supplier', entityId: created.id, entityLabel: name, summary: `إضافة مورد: ${name}`, after: created })
  return created
}

export interface BillInput {
  supplierId: number
  date: DateOnly
  dueDate?: DateOnly | null
  expenseAccountId?: number | null
  amount: string
  supplierInvoiceNo?: string | null
  description?: string | null
  notes?: string | null
  isOpening?: boolean
}

/** فاتورة مورد بالآجل: م المصروف / د ذمم الموردين. الرصيد الافتتاحي: م أرصدة افتتاحية / د ذمم الموردين. */
export async function createSupplierBill(tx: Tx, ctx: Ctx, input: BillInput) {
  const { finance } = await getSettings(tx)
  const amount = round(input.amount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } })
  if (!supplier) throw new BusinessError('المورد غير موجود')
  const year = await resolveOpenYear(tx, input.date)
  let debitAccountId: number
  if (input.isOpening) {
    debitAccountId = await accountIdByKey(tx, 'OPENING_BALANCE')
  } else {
    const acc = await tx.account.findUnique({ where: { id: input.expenseAccountId ?? -1 } })
    if (!acc || acc.isGroup || !acc.isActive || (acc.type !== 'EXPENSE' && acc.type !== 'ASSET')) {
      throw new BusinessError('اختر نوع المصروف', { expenseAccountId: 'اختر نوع المصروف' })
    }
    debitAccountId = acc.id
  }
  const number = await nextDocumentNumber(tx, 'bill', input.date)
  const bill = await tx.supplierBill.create({
    data: {
      number,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      supplierId: supplier.id,
      date: fromDateOnly(input.date),
      dueDate: input.dueDate ? fromDateOnly(input.dueDate) : null,
      academicYearId: year.id,
      expenseAccountId: debitAccountId,
      amount: toDb(amount),
      description: input.description ?? null,
      notes: input.notes ?? null,
      isOpening: !!input.isOpening,
      createdById: ctx.userId,
    },
  })
  const ap = await accountIdByKey(tx, 'AP_SUPPLIERS')
  const desc = input.isOpening
    ? `رصيد افتتاحي للمورد ${supplier.name}`
    : `فاتورة ${number}${input.supplierInvoiceNo ? ` (رقم المورد ${input.supplierInvoiceNo})` : ''} — ${supplier.name}${input.description ? ` — ${input.description}` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: desc,
    sourceType: 'SUPPLIER_BILL',
    sourceId: bill.id,
    lines: [
      { accountId: debitAccountId, debit: amount, supplierId: supplier.id, description: desc },
      { accountId: ap, credit: amount, supplierId: supplier.id, description: desc },
    ],
  })
  await tx.supplierBill.update({ where: { id: bill.id }, data: { journalEntryId: entry.id } })
  await audit(tx, ctx, { action: 'create', entityType: 'SupplierBill', entityId: bill.id, entityLabel: number, summary: `${desc}: ${amount.toFixed(finance.decimals)}`, after: bill })
  return tx.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })
}

export async function cancelSupplierBill(tx: Tx, ctx: Ctx, billId: number, reason: string) {
  const bill = await tx.supplierBill.findUnique({ where: { id: billId }, include: { supplier: true } })
  if (!bill) throw new BusinessError('الفاتورة غير موجودة')
  if (bill.status === 'CANCELLED') throw new BusinessError('الفاتورة ملغاة مسبقًا')
  const date = await todayOf(tx)
  const rev = bill.journalEntryId
    ? await reverseEntry(tx, ctx, bill.journalEntryId, { date, description: `إلغاء فاتورة المورد ${bill.number} — ${reason}`, sourceType: 'SUPPLIER_BILL_CANCEL' })
    : null
  await tx.supplierBill.update({
    where: { id: billId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, reversalEntryId: rev?.id ?? null },
  })
  await audit(tx, ctx, { action: 'cancel', entityType: 'SupplierBill', entityId: billId, entityLabel: bill.number, summary: `إلغاء فاتورة ${bill.number} للمورد ${bill.supplier.name} — ${reason}`, before: bill })
}

/** المستحق للمورد (دائن − مدين على حساب ذمم الموردين). */
export async function supplierBalance(client: DbOrTx, supplierId: number) {
  const ap = await accountIdByKey(client, 'AP_SUPPLIERS')
  const t = await partyBalance(client, ap, { supplierId })
  return t.credit.minus(t.debit)
}

export async function listSuppliers(client: DbOrTx, f: { q?: string; active?: boolean; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (f.q) {
    const { text, digits } = prepareSearchQuery(f.q)
    if (text) conds.push(digits.length >= 3 ? Prisma.sql`(s."searchText" LIKE ${`%${text}%`} OR s."searchText" LIKE ${`%${digits}%`})` : Prisma.sql`s."searchText" LIKE ${`%${text}%`}`)
  }
  if (f.active !== undefined) conds.push(Prisma.sql`s."isActive" = ${f.active}`)
  const ap = await accountIdByKey(client, 'AP_SUPPLIERS')
  // الفواتير والدفعات من المستندات الفعالة، والرصيد من الأستاذ العام
  const rows = await client.$queryRaw<{ id: number; name: string; category: string | null; phone: string | null; isActive: boolean; bills: string; paid: string; balance: string }[]>`
    SELECT s."id", s."name", s."category", s."phone", s."isActive",
      COALESCE((SELECT SUM(b."amount") FROM "supplier_bills" b WHERE b."supplierId" = s."id" AND b."status" = 'ACTIVE'), 0)::text AS bills,
      COALESCE((SELECT SUM(v."amount") FROM "payment_vouchers" v WHERE v."supplierId" = s."id" AND v."kind" = 'SUPPLIER_PAYMENT' AND v."status" = 'ACTIVE'), 0)::text AS paid,
      COALESCE((SELECT SUM(jl."credit" - jl."debit") FROM "journal_lines" jl WHERE jl."supplierId" = s."id" AND jl."accountId" = ${ap}), 0)::text AS balance
    FROM "suppliers" s
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY s."isActive" DESC, s."name" ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  const [c] = await client.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "suppliers" s WHERE ${Prisma.join(conds, ' AND ')}`
  const total = Number(c.count)
  return {
    rows: rows.map((r) => ({ ...r, bills: D(r.bills).toString(), paid: D(r.paid).toString(), balance: D(r.balance).toString() })),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/** ملخص مورد: إجمالي الفواتير الفعالة، المدفوع، المستحق (من الأستاذ). */
export async function supplierSummary(client: DbOrTx, supplierId: number) {
  const [bills, paid, balance] = await Promise.all([
    client.supplierBill.aggregate({ where: { supplierId, status: 'ACTIVE' }, _sum: { amount: true }, _count: true }),
    client.paymentVoucher.aggregate({ where: { supplierId, kind: 'SUPPLIER_PAYMENT', status: 'ACTIVE' }, _sum: { amount: true } }),
    supplierBalance(client, supplierId),
  ])
  return { bills: D(bills._sum.amount).toString(), billsCount: bills._count, paid: D(paid._sum.amount).toString(), balance: balance.toString() }
}

export async function listSupplierBills(client: DbOrTx, f: { supplierId?: number; status?: string; from?: DateOnly; to?: DateOnly; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const and: Prisma.SupplierBillWhereInput[] = []
  if (f.supplierId) and.push({ supplierId: f.supplierId })
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  const where = and.length ? { AND: and } : {}
  const [rows, total] = await Promise.all([
    client.supplierBill.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } }, expenseAccount: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.supplierBill.count({ where }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getSupplierBill(client: DbOrTx, id: number) {
  return client.supplierBill.findUnique({ where: { id }, include: { supplier: true, expenseAccount: true, academicYear: true } })
}

// ---------------------------------------------------------------------
// العمال والمقاولون
// ---------------------------------------------------------------------

export async function saveContractor(
  tx: Tx,
  ctx: Ctx,
  input: { id?: number | null; name: string; specialty?: string | null; phone?: string | null; nationalId?: string | null; notes?: string | null; isActive?: boolean },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('الاسم مطلوب', { name: 'مطلوب' })
  const data = {
    name,
    specialty: input.specialty ?? null,
    phone: cleanPhone(input.phone),
    nationalId: input.nationalId ?? null,
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
    searchText: buildSearchText([name, input.specialty, input.phone, input.nationalId]),
  }
  if (input.id) {
    const before = await tx.contractor.findUniqueOrThrow({ where: { id: input.id } })
    const after = await tx.contractor.update({ where: { id: input.id }, data })
    await audit(tx, ctx, { action: 'update', entityType: 'Contractor', entityId: after.id, entityLabel: after.name, before, after })
    return after
  }
  const created = await tx.contractor.create({ data })
  await audit(tx, ctx, { action: 'create', entityType: 'Contractor', entityId: created.id, entityLabel: name, summary: `إضافة متعامل: ${name}${input.specialty ? ` (${input.specialty})` : ''}`, after: created })
  return created
}

export interface JobInput {
  contractorId: number
  description: string
  agreedAmount: string
  startDate: DateOnly
  endDate?: DateOnly | null
  expenseAccountId: number
  notes?: string | null
}

/** عمل/اتفاق جديد: م المصروف / د ذمم المقاولين بقيمة الاتفاق. */
export async function createContractorJob(tx: Tx, ctx: Ctx, input: JobInput) {
  const { finance } = await getSettings(tx)
  const amount = round(input.agreedAmount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('قيمة الاتفاق يجب أن تكون أكبر من صفر', { agreedAmount: 'أكبر من صفر' })
  const contractor = await tx.contractor.findUnique({ where: { id: input.contractorId } })
  if (!contractor) throw new BusinessError('المتعامل غير موجود')
  const acc = await tx.account.findUnique({ where: { id: input.expenseAccountId } })
  if (!acc || acc.isGroup || !acc.isActive || (acc.type !== 'EXPENSE' && acc.type !== 'ASSET')) {
    throw new BusinessError('اختر نوع المصروف', { expenseAccountId: 'اختر نوع المصروف' })
  }
  const year = await resolveOpenYear(tx, input.startDate)
  const job = await tx.contractorJob.create({
    data: {
      contractorId: contractor.id,
      description: input.description.trim(),
      agreedAmount: toDb(amount),
      startDate: fromDateOnly(input.startDate),
      endDate: input.endDate ? fromDateOnly(input.endDate) : null,
      academicYearId: year.id,
      expenseAccountId: acc.id,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  })
  const desc = `اتفاق عمل: ${job.description} — ${contractor.name}${contractor.specialty ? ` (${contractor.specialty})` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.startDate,
    description: desc,
    sourceType: 'CONTRACTOR_JOB',
    sourceId: job.id,
    lines: [
      { accountId: acc.id, debit: amount, contractorId: contractor.id, description: desc },
      { accountId: await accountIdByKey(tx, 'AP_CONTRACTORS'), credit: amount, contractorId: contractor.id, description: desc },
    ],
  })
  await tx.contractorJob.update({ where: { id: job.id }, data: { journalEntryId: entry.id } })
  await audit(tx, ctx, { action: 'create', entityType: 'ContractorJob', entityId: job.id, entityLabel: job.description, summary: `${desc}: ${amount.toFixed(finance.decimals)}`, after: job })
  return tx.contractorJob.findUniqueOrThrow({ where: { id: job.id } })
}

/** تعديل قيمة الاتفاق بقيد فرق (زيادة أو تخفيض). */
export async function adjustContractorJob(tx: Tx, ctx: Ctx, jobId: number, input: { newAmount: string; reason: string; date: DateOnly }) {
  const { finance } = await getSettings(tx)
  const job = await tx.contractorJob.findUnique({ where: { id: jobId }, include: { contractor: true } })
  if (!job) throw new BusinessError('العمل غير موجود')
  if (job.status === 'CANCELLED') throw new BusinessError('العمل ملغي')
  const newAmount = round(input.newAmount, finance.decimals)
  if (newAmount.lessThan(D(job.paidAmount))) throw new BusinessError(`لا يمكن أن تقل قيمة الاتفاق عن المدفوع (${D(job.paidAmount).toFixed(finance.decimals)})`)
  const delta = newAmount.minus(D(job.agreedAmount))
  if (delta.isZero()) throw new BusinessError('لم تتغير القيمة')
  const ap = await accountIdByKey(tx, 'AP_CONTRACTORS')
  const desc = `تعديل قيمة اتفاق «${job.description}» — ${job.contractor.name} — ${input.reason}`
  await postEntry(tx, ctx, {
    date: input.date,
    description: desc,
    sourceType: 'CONTRACTOR_JOB_ADJUST',
    sourceId: job.id,
    lines: delta.isPositive()
      ? [
          { accountId: job.expenseAccountId, debit: delta, contractorId: job.contractorId, description: desc },
          { accountId: ap, credit: delta, contractorId: job.contractorId, description: desc },
        ]
      : [
          { accountId: ap, debit: delta.abs(), contractorId: job.contractorId, description: desc },
          { accountId: job.expenseAccountId, credit: delta.abs(), contractorId: job.contractorId, description: desc },
        ],
  })
  const after = await tx.contractorJob.update({ where: { id: jobId }, data: { agreedAmount: toDb(newAmount) } })
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'ContractorJob',
    entityId: jobId,
    entityLabel: job.description,
    summary: `${desc}: من ${D(job.agreedAmount).toFixed(finance.decimals)} إلى ${newAmount.toFixed(finance.decimals)}`,
    before: { agreedAmount: job.agreedAmount },
    after: { agreedAmount: after.agreedAmount },
  })
}

export async function setJobStatus(tx: Tx, ctx: Ctx, jobId: number, status: 'OPEN' | 'COMPLETED' | 'CANCELLED', reason?: string) {
  const job = await tx.contractorJob.findUnique({ where: { id: jobId }, include: { contractor: true } })
  if (!job) throw new BusinessError('العمل غير موجود')
  if (job.status === 'CANCELLED') throw new BusinessError('العمل ملغي')
  if (status === 'CANCELLED') {
    const today = await todayOf(tx)
    if (D(job.paidAmount).greaterThan(0)) {
      // إلغاء الجزء غير المدفوع فقط
      if (D(job.agreedAmount).greaterThan(D(job.paidAmount))) {
        await adjustContractorJob(tx, ctx, jobId, { newAmount: job.paidAmount.toString(), reason: `إلغاء الجزء المتبقي: ${reason ?? ''}`, date: today })
      }
    } else if (job.journalEntryId) {
      await reverseEntry(tx, ctx, job.journalEntryId, { date: today, description: `إلغاء اتفاق «${job.description}» — ${reason ?? ''}`, sourceType: 'CONTRACTOR_JOB_ADJUST' })
      await tx.contractorJob.update({ where: { id: jobId }, data: { agreedAmount: '0' } })
    }
  }
  await tx.contractorJob.update({ where: { id: jobId }, data: { status } })
  await audit(tx, ctx, { action: 'status', entityType: 'ContractorJob', entityId: jobId, entityLabel: job.description, summary: `تغيير حالة العمل «${job.description}» إلى ${status}${reason ? ` — ${reason}` : ''}` })
}

export async function recomputeJobPaid(tx: Tx, jobId: number) {
  const agg = await tx.paymentVoucher.aggregate({ where: { contractorJobId: jobId, status: 'ACTIVE' }, _sum: { amount: true } })
  await tx.contractorJob.update({ where: { id: jobId }, data: { paidAmount: toDb(D(agg._sum.amount)) } })
}

export async function listContractors(client: DbOrTx, f: { q?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (f.q) {
    const { text, digits } = prepareSearchQuery(f.q)
    if (text) conds.push(digits.length >= 3 ? Prisma.sql`(c."searchText" LIKE ${`%${text}%`} OR c."searchText" LIKE ${`%${digits}%`})` : Prisma.sql`c."searchText" LIKE ${`%${text}%`}`)
  }
  const rows = await client.$queryRaw<{ id: number; name: string; specialty: string | null; phone: string | null; isActive: boolean; jobs: bigint; agreed: string; paid: string }[]>`
    SELECT c."id", c."name", c."specialty", c."phone", c."isActive",
           COUNT(j."id") FILTER (WHERE j."status" <> 'CANCELLED') AS jobs,
           COALESCE(SUM(j."agreedAmount"), 0)::text AS agreed,
           COALESCE(SUM(j."paidAmount"), 0)::text AS paid
    FROM "contractors" c LEFT JOIN "contractor_jobs" j ON j."contractorId" = c."id"
    WHERE ${Prisma.join(conds, ' AND ')}
    GROUP BY c."id"
    ORDER BY c."isActive" DESC, c."name" ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  const [cnt] = await client.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "contractors" c WHERE ${Prisma.join(conds, ' AND ')}`
  const total = Number(cnt.count)
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

