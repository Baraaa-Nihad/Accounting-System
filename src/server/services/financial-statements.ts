import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx } from '../db'
import { NOT_CLOSING_SQL } from '../ledger/sources'
import { addDays, fromDateOnly, type DateOnly } from '@/lib/dates'
import { D, sum } from '@/lib/money'
import type Decimal from 'decimal.js'

/**
 * القوائم المالية من الأستاذ العام (docs/13-accounting.md §13.6):
 * ميزان المراجعة، قائمة الدخل (بدون قيود الإقفال)، والميزانية العمومية في تاريخ.
 */

interface Acc {
  id: number
  code: string
  name: string
  type: string
  isGroup: boolean
  parentId: number | null
  systemKey: string | null
  isActive: boolean
}

async function allAccounts(client: DbOrTx): Promise<Acc[]> {
  return client.account.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, type: true, isGroup: true, parentId: true, systemKey: true, isActive: true } })
}

/** مجاميع الحسابات: مدين/دائن ضمن نطاق، مع خيار استبعاد قيود الإقفال. */
async function lineSums(client: DbOrTx, range: { from?: DateOnly | null; to?: DateOnly | null; excludeClosing?: boolean }) {
  const conds: Prisma.Sql[] = []
  if (range.from) conds.push(Prisma.sql`jl."date" >= ${fromDateOnly(range.from)}`)
  if (range.to) conds.push(Prisma.sql`jl."date" <= ${fromDateOnly(range.to)}`)
  if (range.excludeClosing) conds.push(NOT_CLOSING_SQL)
  const rows = await client.$queryRaw<{ accountId: number; debit: string; credit: string }[]>`
    SELECT jl."accountId" AS "accountId", COALESCE(SUM(jl."debit"), 0)::text AS debit, COALESCE(SUM(jl."credit"), 0)::text AS credit
    FROM "journal_lines" jl JOIN "journal_entries" je ON je."id" = jl."entryId"
    ${conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty}
    GROUP BY jl."accountId"`
  return new Map(rows.map((r) => [Number(r.accountId), { debit: D(r.debit), credit: D(r.credit) }]))
}

// ---------------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------------

export interface TrialRow {
  id: number
  code: string
  name: string
  type: string
  openingDebit: Decimal
  openingCredit: Decimal
  periodDebit: Decimal
  periodCredit: Decimal
  closingDebit: Decimal
  closingCredit: Decimal
}

const side = (net: Decimal) => (net.isNegative() ? { debit: D(0), credit: net.abs() } : { debit: net, credit: D(0) })

export async function trialBalance(client: DbOrTx, opts: { from?: DateOnly | null; to: DateOnly; excludeClosing?: boolean; includeZero?: boolean }) {
  const [accounts, before, period] = await Promise.all([
    allAccounts(client),
    opts.from ? lineSums(client, { to: addDays(opts.from, -1), excludeClosing: opts.excludeClosing }) : Promise.resolve(new Map<number, { debit: Decimal; credit: Decimal }>()),
    lineSums(client, { from: opts.from, to: opts.to, excludeClosing: opts.excludeClosing }),
  ])
  const rows: TrialRow[] = []
  for (const a of accounts) {
    if (a.isGroup) continue
    const b = before.get(a.id)
    const p = period.get(a.id)
    const openingNet = b ? b.debit.minus(b.credit) : D(0)
    const pd = p?.debit ?? D(0)
    const pc = p?.credit ?? D(0)
    const closingNet = openingNet.plus(pd).minus(pc)
    if (!opts.includeZero && openingNet.isZero() && pd.isZero() && pc.isZero()) continue
    const o = side(openingNet)
    const c = side(closingNet)
    rows.push({ id: a.id, code: a.code, name: a.name, type: a.type, openingDebit: o.debit, openingCredit: o.credit, periodDebit: pd, periodCredit: pc, closingDebit: c.debit, closingCredit: c.credit })
  }
  const totals = {
    openingDebit: sum(rows.map((r) => r.openingDebit)),
    openingCredit: sum(rows.map((r) => r.openingCredit)),
    periodDebit: sum(rows.map((r) => r.periodDebit)),
    periodCredit: sum(rows.map((r) => r.periodCredit)),
    closingDebit: sum(rows.map((r) => r.closingDebit)),
    closingCredit: sum(rows.map((r) => r.closingCredit)),
  }
  return { rows, totals, balanced: totals.closingDebit.equals(totals.closingCredit) && totals.periodDebit.equals(totals.periodCredit) }
}


// ---------------------------------------------------------------------
// أقسام هرمية (قائمة الدخل والميزانية)
// ---------------------------------------------------------------------

export interface SectionRow {
  id: number
  code: string
  name: string
  depth: number
  isGroup: boolean
  amount: Decimal
}

/** صفوف قسم من الشجرة تحت جذر معين، مع مجاميع المجموعات وإخفاء الأصفار. */
function buildSection(accounts: Acc[], amountOf: (a: Acc) => Decimal, rootId: number, exclude: (a: Acc) => boolean = () => false): { rows: SectionRow[]; total: Decimal } {
  const children = new Map<number, Acc[]>()
  for (const a of accounts) if (a.parentId !== null) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a])
  const rows: SectionRow[] = []
  const walk = (a: Acc, depth: number): Decimal => {
    if (exclude(a)) return D(0)
    if (!a.isGroup) {
      const amt = amountOf(a)
      if (!amt.isZero()) rows.push({ id: a.id, code: a.code, name: a.name, depth, isGroup: false, amount: amt })
      return amt
    }
    const idx = rows.length
    rows.push({ id: a.id, code: a.code, name: a.name, depth, isGroup: true, amount: D(0) })
    const total = sum((children.get(a.id) ?? []).map((c) => walk(c, depth + 1)))
    if (total.isZero() && rows.length === idx + 1) rows.pop()
    else rows[idx].amount = total
    return total
  }
  const root = accounts.find((a) => a.id === rootId)
  if (!root) return { rows: [], total: D(0) }
  const total = sum((children.get(root.id) ?? []).map((c) => walk(c, 0)))
  return { rows, total }
}

const rootOf = (accounts: Acc[], key: string) => accounts.find((a) => a.systemKey === key)?.id ?? -1

// ---------------------------------------------------------------------
// قائمة الدخل
// ---------------------------------------------------------------------

export async function incomeStatement(client: DbOrTx, opts: { from: DateOnly; to: DateOnly }) {
  const [accounts, sums, partners] = await Promise.all([
    allAccounts(client),
    lineSums(client, { from: opts.from, to: opts.to, excludeClosing: true }),
    client.partner.findMany({ where: { isActive: true, ownershipPercent: { gt: 0 } }, orderBy: { name: 'asc' } }),
  ])
  const credit = (a: Acc) => {
    const s = sums.get(a.id)
    return s ? s.credit.minus(s.debit) : D(0)
  }
  const debit = (a: Acc) => credit(a).negated()
  const discountsAcc = accounts.find((a) => a.systemKey === 'DISCOUNTS_ALLOWED')
  const revenue = buildSection(accounts, credit, rootOf(accounts, 'REVENUE'), (a) => a.id === discountsAcc?.id)
  const discounts = discountsAcc ? debit(discountsAcc) : D(0)
  const netRevenue = revenue.total.minus(discounts)
  const expenses = buildSection(accounts, debit, rootOf(accounts, 'EXPENSES'))
  const netIncome = netRevenue.minus(expenses.total)
  return {
    revenue,
    discounts,
    netRevenue,
    expenses,
    netIncome,
    partners: partners.map((p) => ({ id: p.id, name: p.name, percent: D(p.ownershipPercent), share: netIncome.times(D(p.ownershipPercent)).dividedBy(100).toDecimalPlaces(3) })),
  }
}

// ---------------------------------------------------------------------
// الميزانية العمومية
// ---------------------------------------------------------------------

export async function balanceSheet(client: DbOrTx, opts: { asOf: DateOnly }) {
  const [accounts, sums] = await Promise.all([allAccounts(client), lineSums(client, { to: opts.asOf })])
  const net = (a: Acc) => {
    const s = sums.get(a.id)
    return s ? s.debit.minus(s.credit) : D(0)
  }
  const assets = buildSection(accounts, net, rootOf(accounts, 'ASSETS'))
  const liabilities = buildSection(accounts, (a) => net(a).negated(), rootOf(accounts, 'LIABILITIES'))
  const equity = buildSection(accounts, (a) => net(a).negated(), rootOf(accounts, 'EQUITY'))
  // صافي ربح السنوات غير المقفلة = أرصدة الإيرادات والمصروفات المتبقية حتى التاريخ
  const unclosedIncome = sum(accounts.filter((a) => !a.isGroup && (a.type === 'REVENUE' || a.type === 'EXPENSE')).map((a) => net(a).negated()))
  const totalLiabilitiesEquity = liabilities.total.plus(equity.total).plus(unclosedIncome)
  return { assets, liabilities, equity, unclosedIncome, totalLiabilitiesEquity, balanced: assets.total.equals(totalLiabilitiesEquity) }
}
