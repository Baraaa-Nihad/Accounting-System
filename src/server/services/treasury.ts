import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { CashAccountType } from '@/generated/prisma/enums'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { resolveOpenYear } from '../years'
import { nextDocumentNumber } from '../numbering'
import { postEntry, reverseEntry } from '../ledger/posting'
import { accountIdByKey, createChildAccount } from '../ledger/accounts'
import { accountTotals } from '../ledger/balances'
import { D, round, toDb } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'
import type { Permission } from '@/lib/permissions'
import type Decimal from 'decimal.js'

/**
 * الصندوق والبنوك (docs/05-workflows.md §5.20)
 */

// ---------------------------------------------------------------------
// عهدة الصناديق: صندوق نقدي في عهدة موظف (مستخدم) أو شريك.
// من في عهدته صندوق ولا يملك «treasury.all_boxes» يقبض ويصرف ويحوّل من صناديقه فقط؛
// الحسابات البنكية لا عهدة عليها وتبقى متاحة للجميع. من لا عهدة له يعمل كما كان.
// ---------------------------------------------------------------------

/** صناديق المستخدم (الفعالة والمعطلة) وهل هو مقيّد بها. */
export async function boxAccess(client: DbOrTx, userId: number | null, permissions: Set<Permission>) {
  const own = userId
    ? (await client.cashAccount.findMany({ where: { type: 'CASHBOX', OR: [{ custodianId: userId }, { partner: { userId } }] }, select: { id: true }, orderBy: { name: 'asc' } })).map((r) => r.id)
    : []
  return { own, restricted: own.length > 0 && !permissions.has('treasury.all_boxes') }
}

/** يمنع المقيّد بعهدته من استخدام صندوق نقدي ليس في عهدته. */
export async function assertBoxAllowed(tx: Tx, ctx: Ctx, cashAccountId: number, field = 'cashAccountId') {
  const { own, restricted } = await boxAccess(tx, ctx.userId, ctx.permissions)
  if (!restricted || own.includes(cashAccountId)) return
  const ca = await tx.cashAccount.findUnique({ where: { id: cashAccountId }, select: { name: true, type: true } })
  if (!ca || ca.type === 'BANK') return
  throw new BusinessError(`«${ca.name}» ليس في عهدتك؛ سجّل على صندوقك أو على حساب بنكي.`, { [field]: 'ليس في عهدتك' })
}

export interface BoxOption {
  id: number
  name: string
  type: CashAccountType
  balance: string
  /** المقترح لهذا المستخدم في السندات: صندوق عهدته أولًا، ثم الصندوق الافتراضي */
  isDefault: boolean
}

/** الصناديق والحسابات التي يستخدمها المستخدم في السندات مع أرصدتها. */
export async function boxOptionsFor(client: DbOrTx, userId: number | null, permissions: Set<Permission>): Promise<BoxOption[]> {
  const [summary, access] = await Promise.all([cashAccountsSummary(client), boxAccess(client, userId, permissions)])
  const active = summary.filter((a) => a.isActive)
  const list = access.restricted ? active.filter((a) => a.type === 'BANK' || access.own.includes(a.id)) : active
  const preferred =
    list.find((a) => access.own.includes(a.id)) ?? list.find((a) => a.isDefault && a.type === 'CASHBOX') ?? list.find((a) => a.isDefault) ?? list[0]
  return list.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance, isDefault: a.id === preferred?.id }))
}

/** يتحقق من صاحب العهدة: للصناديق النقدية فقط، ولشخص واحد (موظف أو شريك). */
async function custodyData(tx: Tx, type: CashAccountType, input: { custodianId?: number | null; partnerId?: number | null }) {
  const custodianId = input.custodianId ?? null
  const partnerId = input.partnerId ?? null
  if (custodianId && partnerId) throw new BusinessError('الصندوق في عهدة شخص واحد: موظف أو شريك', { custodianId: 'اختر واحدًا فقط' })
  if ((custodianId || partnerId) && type !== 'CASHBOX') throw new BusinessError('العهدة للصناديق النقدية فقط، لا للحسابات البنكية', { custodianId: 'للصناديق فقط' })
  if (custodianId) {
    const u = await tx.user.findUnique({ where: { id: custodianId }, select: { isActive: true } })
    if (!u?.isActive) throw new BusinessError('الموظف المختار غير موجود أو غير فعال', { custodianId: 'غير متاح' })
  }
  if (partnerId) {
    const p = await tx.partner.findUnique({ where: { id: partnerId }, select: { isActive: true } })
    if (!p?.isActive) throw new BusinessError('الشريك المختار غير موجود أو غير فعال', { partnerId: 'غير متاح' })
  }
  return { custodianId, partnerId }
}

async function custodyLabel(tx: Tx, data: { custodianId: number | null; partnerId: number | null }) {
  if (data.custodianId) return `في عهدة ${(await tx.user.findUniqueOrThrow({ where: { id: data.custodianId } })).fullName}`
  if (data.partnerId) return `صندوق الشريك ${(await tx.partner.findUniqueOrThrow({ where: { id: data.partnerId } })).name}`
  return null
}

export async function createCashAccount(
  tx: Tx,
  ctx: Ctx,
  input: {
    name: string
    type: CashAccountType
    bankName?: string | null
    accountNumber?: string | null
    iban?: string | null
    openingBalance?: string | null
    openingDate?: DateOnly | null
    lowBalanceAlert?: string | null
    isDefault?: boolean
    notes?: string | null
    custodianId?: number | null
    partnerId?: number | null
  },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم الحساب مطلوب')
  if (await tx.cashAccount.findUnique({ where: { name } })) throw new BusinessError('يوجد صندوق/حساب بنفس الاسم')
  const custody = await custodyData(tx, input.type, input)
  const gl = await createChildAccount(tx, input.type === 'CASHBOX' ? 'CASH_GROUP' : 'BANK_GROUP', name)
  if (input.isDefault) await tx.cashAccount.updateMany({ where: { type: input.type }, data: { isDefault: false } })
  const account = await tx.cashAccount.create({
    data: {
      name,
      type: input.type,
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      iban: input.iban ?? null,
      glAccountId: gl.id,
      lowBalanceAlert: input.lowBalanceAlert ? toDb(input.lowBalanceAlert) : null,
      isDefault: !!input.isDefault,
      notes: input.notes ?? null,
      ...custody,
    },
  })
  const opening = D(input.openingBalance)
  if (opening.greaterThan(0)) {
    const date = input.openingDate ?? (await todayOf(tx))
    await postEntry(tx, ctx, {
      date,
      description: `رصيد افتتاحي — ${name}`,
      sourceType: 'OPENING',
      sourceId: account.id,
      lines: [
        { accountId: gl.id, debit: opening },
        { accountId: await accountIdByKey(tx, 'OPENING_BALANCE'), credit: opening },
      ],
    })
  }
  const custodyText = await custodyLabel(tx, custody)
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'CashAccount',
    entityId: account.id,
    entityLabel: name,
    summary: `إضافة ${input.type === 'CASHBOX' ? 'صندوق' : 'حساب بنكي'}: ${name}${custodyText ? ` (${custodyText})` : ''}${opening.greaterThan(0) ? ` برصيد افتتاحي ${opening.toString()}` : ''}`,
    after: account,
  })
  return account
}

export async function updateCashAccount(
  tx: Tx,
  ctx: Ctx,
  id: number,
  input: {
    name: string
    bankName?: string | null
    accountNumber?: string | null
    iban?: string | null
    lowBalanceAlert?: string | null
    isDefault?: boolean
    isActive: boolean
    notes?: string | null
    custodianId?: number | null
    partnerId?: number | null
  },
) {
  const before = await tx.cashAccount.findUnique({ where: { id } })
  if (!before) throw new BusinessError('الحساب غير موجود')
  if (before.isActive && !input.isActive) {
    const balance = (await accountTotals(tx, before.glAccountId)).net
    if (!balance.isZero()) throw new BusinessError(`لا يمكن تعطيل حساب رصيده ${balance.toString()}. حوّل رصيده أولًا.`)
  }
  const custody = await custodyData(tx, before.type, input)
  if (input.isDefault) await tx.cashAccount.updateMany({ where: { type: before.type, id: { not: id } }, data: { isDefault: false } })
  const after = await tx.cashAccount.update({
    where: { id },
    data: {
      name: input.name.trim(),
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      iban: input.iban ?? null,
      lowBalanceAlert: input.lowBalanceAlert ? toDb(input.lowBalanceAlert) : null,
      isDefault: !!input.isDefault,
      isActive: input.isActive,
      notes: input.notes ?? null,
      ...custody,
    },
  })
  if (after.name !== before.name) await tx.account.update({ where: { id: before.glAccountId }, data: { name: after.name } })
  const custodyChanged = before.custodianId !== after.custodianId || before.partnerId !== after.partnerId
  const custodyText = custodyChanged ? (await custodyLabel(tx, custody)) ?? 'بلا عهدة' : null
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'CashAccount',
    entityId: id,
    entityLabel: after.name,
    ...(custodyText ? { summary: `تعديل ${after.name} — العهدة: ${custodyText}` } : {}),
    before,
    after,
  })
  return after
}

/**
 * التحقق من كفاية الرصيد قبل أي صرف أو تحويل.
 * يقفل صف الصندوق حتى نهاية المعاملة لمنع صرفين متزامنين يتجاوزان الرصيد.
 */
export async function assertSufficientBalance(tx: Tx, cashAccountId: number, amount: Decimal) {
  const { finance } = await getSettings(tx)
  await tx.$queryRaw`SELECT "id" FROM "cash_accounts" WHERE "id" = ${cashAccountId} FOR UPDATE`
  const ca = await tx.cashAccount.findUnique({ where: { id: cashAccountId } })
  if (!ca || !ca.isActive) throw new BusinessError('الصندوق/الحساب غير متاح', { cashAccountId: 'غير متاح' })
  if (finance.allowNegativeCash) return ca
  const balance = (await accountTotals(tx, ca.glAccountId)).net
  if (amount.greaterThan(balance)) {
    throw new BusinessError(`الرصيد المتاح في «${ca.name}» هو ${balance.toFixed(finance.decimals)} فقط، ولا يكفي لصرف ${amount.toFixed(finance.decimals)}.`, {
      amount: 'أكبر من الرصيد المتاح',
    })
  }
  return ca
}

export async function createTransfer(
  tx: Tx,
  ctx: Ctx,
  input: { date: DateOnly; fromAccountId: number; toAccountId: number; amount: string; description?: string | null; notes?: string | null },
) {
  const { finance } = await getSettings(tx)
  const amount = round(input.amount, finance.decimals)
  if (!amount.greaterThan(0)) throw new BusinessError('المبلغ يجب أن يكون أكبر من صفر', { amount: 'أكبر من صفر' })
  if (input.fromAccountId === input.toAccountId) throw new BusinessError('لا يمكن التحويل إلى نفس الحساب', { toAccountId: 'اختر حسابًا مختلفًا' })
  const year = await resolveOpenYear(tx, input.date)
  // المقيّد بعهدته يحوّل من صناديقه فقط (تسليم النقدية)، وإلى أي صندوق أو بنك
  await assertBoxAllowed(tx, ctx, input.fromAccountId, 'fromAccountId')
  const from = await assertSufficientBalance(tx, input.fromAccountId, amount)
  const to = await tx.cashAccount.findUnique({ where: { id: input.toAccountId } })
  if (!to || !to.isActive) throw new BusinessError('الحساب المحوَّل إليه غير متاح')
  const number = await nextDocumentNumber(tx, 'transfer', input.date)
  const transfer = await tx.cashTransfer.create({
    data: {
      number,
      date: fromDateOnly(input.date),
      academicYearId: year.id,
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: toDb(amount),
      description: input.description ?? null,
      notes: input.notes ?? null,
      createdById: ctx.userId,
    },
  })
  const desc = `تحويل ${number} من ${from.name} إلى ${to.name}${input.description ? ` — ${input.description}` : ''}`
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: desc,
    sourceType: 'TRANSFER',
    sourceId: transfer.id,
    lines: [
      { accountId: to.glAccountId, debit: amount, description: desc },
      { accountId: from.glAccountId, credit: amount, description: desc },
    ],
  })
  await tx.cashTransfer.update({ where: { id: transfer.id }, data: { journalEntryId: entry.id } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'CashTransfer',
    entityId: transfer.id,
    entityLabel: number,
    summary: `${desc}: ${amount.toFixed(finance.decimals)}`,
    after: transfer,
  })
  return tx.cashTransfer.findUniqueOrThrow({ where: { id: transfer.id } })
}

export async function cancelTransfer(tx: Tx, ctx: Ctx, id: number, reason: string) {
  const t = await tx.cashTransfer.findUnique({ where: { id } })
  if (!t) throw new BusinessError('التحويل غير موجود')
  if (t.status === 'CANCELLED') throw new BusinessError('التحويل ملغي مسبقًا')
  // عكس التحويل يسحب المبلغ من الحساب المحوَّل إليه
  await assertSufficientBalance(tx, t.toAccountId, D(t.amount))
  const date = await todayOf(tx)
  const rev = t.journalEntryId ? await reverseEntry(tx, ctx, t.journalEntryId, { date, description: `إلغاء التحويل ${t.number} — ${reason}`, sourceType: 'TRANSFER_CANCEL' }) : null
  await tx.cashTransfer.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, reversalEntryId: rev?.id ?? null },
  })
  await audit(tx, ctx, { action: 'cancel', entityType: 'CashTransfer', entityId: id, entityLabel: t.number, summary: `إلغاء التحويل ${t.number} — ${reason}`, before: t })
}

export interface CashAccountSummary {
  id: number
  name: string
  type: CashAccountType
  bankName: string | null
  accountNumber: string | null
  iban: string | null
  isActive: boolean
  isDefault: boolean
  lowBalanceAlert: string | null
  glAccountId: number
  glCode: string
  custodianId: number | null
  custodianName: string | null
  partnerId: number | null
  partnerName: string | null
  opening: string
  receipts: string
  payments: string
  transfersIn: string
  transfersOut: string
  balance: string
}

/** ملخص كل صندوق/بنك: الافتتاحي، المقبوضات، المدفوعات، التحويلات، الرصيد الحالي (لفترة اختيارية). */
export async function cashAccountsSummary(client: DbOrTx = db, range?: { from?: DateOnly; to?: DateOnly }): Promise<CashAccountSummary[]> {
  const accounts = await client.cashAccount.findMany({
    orderBy: [{ isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }],
    include: { glAccount: true, custodian: { select: { fullName: true } }, partner: { select: { name: true } } },
  })
  if (accounts.length === 0) return []
  const ids = accounts.map((a) => a.glAccountId)
  const conds: Prisma.Sql[] = [Prisma.sql`jl."accountId" IN (${Prisma.join(ids)})`]
  if (range?.to) conds.push(Prisma.sql`jl."date" <= ${fromDateOnly(range.to)}`)
  const from = range?.from ? fromDateOnly(range.from) : null
  // بدون فترة: أزواج الإلغاء (الأصل + العكسي) تُستبعد من التصنيف لأنها تتعادل.
  // مع فترة: تُحسب كل الحركات داخل الفترة حسب اتجاهها حتى تبقى المعادلة دقيقة.
  const inPeriod = from ? Prisma.sql`jl."date" >= ${from}` : Prisma.sql`TRUE`
  const clean = from ? Prisma.sql`TRUE` : Prisma.sql`je."status" = 'POSTED' AND je."reversalOfId" IS NULL`
  const isTransfer = Prisma.sql`je."sourceType" IN ('TRANSFER', 'TRANSFER_CANCEL')`
  const openingCond = from ? Prisma.sql`jl."date" < ${from}` : Prisma.sql`je."sourceType" = 'OPENING'`
  const otherCond = from ? Prisma.sql`NOT (${isTransfer})` : Prisma.sql`je."sourceType" <> 'OPENING' AND NOT (${isTransfer})`
  const rows = await client.$queryRaw<
    { accountId: number; opening: string; receipts: string; payments: string; tin: string; tout: string; balance: string }[]
  >`
    SELECT jl."accountId" AS "accountId",
      COALESCE(SUM(jl."debit" - jl."credit") FILTER (WHERE ${openingCond}), 0)::text AS opening,
      COALESCE(SUM(jl."debit") FILTER (WHERE ${inPeriod} AND ${otherCond} AND ${clean}), 0)::text AS receipts,
      COALESCE(SUM(jl."credit") FILTER (WHERE ${inPeriod} AND ${otherCond} AND ${clean}), 0)::text AS payments,
      COALESCE(SUM(jl."debit") FILTER (WHERE ${inPeriod} AND ${isTransfer} AND ${clean}), 0)::text AS tin,
      COALESCE(SUM(jl."credit") FILTER (WHERE ${inPeriod} AND ${isTransfer} AND ${clean}), 0)::text AS tout,
      COALESCE(SUM(jl."debit" - jl."credit"), 0)::text AS balance
    FROM "journal_lines" jl JOIN "journal_entries" je ON je."id" = jl."entryId"
    WHERE ${Prisma.join(conds, ' AND ')}
    GROUP BY jl."accountId"`
  const byId = new Map(rows.map((r) => [Number(r.accountId), r]))
  return accounts.map((a) => {
    const r = byId.get(a.glAccountId)
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      iban: a.iban,
      isActive: a.isActive,
      isDefault: a.isDefault,
      lowBalanceAlert: a.lowBalanceAlert?.toString() ?? null,
      glAccountId: a.glAccountId,
      glCode: a.glAccount.code,
      custodianId: a.custodianId,
      custodianName: a.custodian?.fullName ?? null,
      partnerId: a.partnerId,
      partnerName: a.partner?.name ?? null,
      opening: D(r?.opening).toString(),
      receipts: D(r?.receipts).toString(),
      payments: D(r?.payments).toString(),
      transfersIn: D(r?.tin).toString(),
      transfersOut: D(r?.tout).toString(),
      balance: D(r?.balance).toString(),
    }
  })
}

export async function listTransfers(
  client: DbOrTx,
  f: { from?: DateOnly; to?: DateOnly; accountId?: number; status?: string; page?: number; pageSize?: number },
) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 5), 1000)
  const page = Math.max(f.page ?? 1, 1)
  const and: Prisma.CashTransferWhereInput[] = []
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  if (f.accountId) and.push({ OR: [{ fromAccountId: f.accountId }, { toAccountId: f.accountId }] })
  if (f.status === 'ACTIVE' || f.status === 'CANCELLED') and.push({ status: f.status })
  const where = and.length ? { AND: and } : {}
  const [rows, total] = await Promise.all([
    client.cashTransfer.findMany({
      where,
      include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    client.cashTransfer.count({ where }),
  ])
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}
