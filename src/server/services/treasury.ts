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
import type Decimal from 'decimal.js'

/**
 * الصندوق والبنوك (docs/05-workflows.md §5.20)
 */

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
  },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم الحساب مطلوب')
  if (await tx.cashAccount.findUnique({ where: { name } })) throw new BusinessError('يوجد صندوق/حساب بنفس الاسم')
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
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'CashAccount',
    entityId: account.id,
    entityLabel: name,
    summary: `إضافة ${input.type === 'CASHBOX' ? 'صندوق' : 'حساب بنكي'}: ${name}${opening.greaterThan(0) ? ` برصيد افتتاحي ${opening.toString()}` : ''}`,
    after: account,
  })
  return account
}

export async function updateCashAccount(
  tx: Tx,
  ctx: Ctx,
  id: number,
  input: { name: string; bankName?: string | null; accountNumber?: string | null; iban?: string | null; lowBalanceAlert?: string | null; isDefault?: boolean; isActive: boolean; notes?: string | null },
) {
  const before = await tx.cashAccount.findUnique({ where: { id } })
  if (!before) throw new BusinessError('الحساب غير موجود')
  if (before.isActive && !input.isActive) {
    const balance = (await accountTotals(tx, before.glAccountId)).net
    if (!balance.isZero()) throw new BusinessError(`لا يمكن تعطيل حساب رصيده ${balance.toString()}. حوّل رصيده أولًا.`)
  }
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
    },
  })
  if (after.name !== before.name) await tx.account.update({ where: { id: before.glAccountId }, data: { name: after.name } })
  await audit(tx, ctx, { action: 'update', entityType: 'CashAccount', entityId: id, entityLabel: after.name, before, after })
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
  opening: string
  receipts: string
  payments: string
  transfersIn: string
  transfersOut: string
  balance: string
}

/** ملخص كل صندوق/بنك: الافتتاحي، المقبوضات، المدفوعات، التحويلات، الرصيد الحالي (لفترة اختيارية). */
export async function cashAccountsSummary(client: DbOrTx = db, range?: { from?: DateOnly; to?: DateOnly }): Promise<CashAccountSummary[]> {
  const accounts = await client.cashAccount.findMany({ orderBy: [{ isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }], include: { glAccount: true } })
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
      opening: D(r?.opening).toString(),
      receipts: D(r?.receipts).toString(),
      payments: D(r?.payments).toString(),
      transfersIn: D(r?.tin).toString(),
      transfersOut: D(r?.tout).toString(),
      balance: D(r?.balance).toString(),
    }
  })
}
