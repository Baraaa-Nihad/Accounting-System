import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { createChildAccount, isFreePostingAccount } from '../ledger/accounts'
import { postEntry, reverseEntry } from '../ledger/posting'
import { addDays, fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'
import { D, sum } from '@/lib/money'
import type Decimal from 'decimal.js'

/**
 * المحاسبة العامة (docs/13-accounting.md): دليل الحسابات، القيود اليومية،
 * القيود اليدوية وعكسها. القيود الآلية لا تُعدل ولا تُعكس من هنا بل من مستنداتها.
 */

// ---------------------------------------------------------------------
// دليل الحسابات
// ---------------------------------------------------------------------

export interface AccountNode {
  id: number
  code: string
  name: string
  type: string
  isGroup: boolean
  isSystem: boolean
  systemKey: string | null
  isActive: boolean
  description: string | null
  parentId: number | null
  depth: number
  /** الرصيد بطبيعة الحساب (مدين للأصول والمصروفات، دائن لغيرها) */
  balance: Decimal
  debit: Decimal
  credit: Decimal
  linked: string | null
}

const DEBIT_NATURE = new Set(['ASSET', 'EXPENSE'])

/** شجرة الحسابات مرتبة بالرمز مع الأرصدة (التجميعية = مجموع فروعها) حتى تاريخ معين. */
export async function accountTree(client: DbOrTx, asOf?: DateOnly | null): Promise<AccountNode[]> {
  const [accounts, sums] = await Promise.all([
    client.account.findMany({
      orderBy: { code: 'asc' },
      include: { cashAccount: { select: { name: true } }, chargeTypes: { select: { name: true } }, partnerCapital: { select: { name: true } }, partnerDrawings: { select: { name: true } } },
    }),
    client.$queryRaw<{ accountId: number; debit: string; credit: string }[]>`
      SELECT jl."accountId" AS "accountId", COALESCE(SUM(jl."debit"), 0)::text AS debit, COALESCE(SUM(jl."credit"), 0)::text AS credit
      FROM "journal_lines" jl
      ${asOf ? Prisma.sql`WHERE jl."date" <= ${fromDateOnly(asOf)}` : Prisma.empty}
      GROUP BY jl."accountId"`,
  ])
  const own = new Map(sums.map((s) => [Number(s.accountId), { debit: D(s.debit), credit: D(s.credit) }]))
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const depthOf = (a: (typeof accounts)[number]): number => (a.parentId && byId.has(a.parentId) ? depthOf(byId.get(a.parentId)!) + 1 : 0)
  // تجميع أرصدة الفروع للآباء
  const totals = new Map<number, { debit: Decimal; credit: Decimal }>()
  for (const a of accounts) {
    const s = own.get(a.id)
    if (!s) continue
    let cur: (typeof accounts)[number] | undefined = a
    while (cur) {
      const t = totals.get(cur.id) ?? { debit: D(0), credit: D(0) }
      totals.set(cur.id, { debit: t.debit.plus(s.debit), credit: t.credit.plus(s.credit) })
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return accounts.map((a) => {
    const t = totals.get(a.id) ?? { debit: D(0), credit: D(0) }
    const net = t.debit.minus(t.credit)
    const linked = a.cashAccount
      ? `صندوق/بنك: ${a.cashAccount.name}`
      : a.chargeTypes.length
        ? `تصنيف ذمة: ${a.chargeTypes.map((c) => c.name).join('، ')}`
        : a.partnerCapital
          ? `رأس مال الشريك ${a.partnerCapital.name}`
          : a.partnerDrawings
            ? `جاري الشريك ${a.partnerDrawings.name}`
            : null
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      isGroup: a.isGroup,
      isSystem: a.isSystem,
      systemKey: a.systemKey,
      isActive: a.isActive,
      description: a.description,
      parentId: a.parentId,
      depth: depthOf(a),
      balance: DEBIT_NATURE.has(a.type) ? net : net.negated(),
      debit: t.debit,
      credit: t.credit,
      linked,
    }
  })
}

export async function createAccount(tx: Tx, ctx: Ctx, input: { parentId: number; name: string; code: string | null; description: string | null; isGroup: boolean }) {
  const parent = await tx.account.findUnique({ where: { id: input.parentId } })
  if (!parent) throw new BusinessError('اختر الحساب الرئيسي', { parentId: 'مطلوب' })
  const dup = await tx.account.findFirst({ where: { parentId: parent.id, name: input.name.trim() } })
  if (dup) throw new BusinessError('يوجد حساب بنفس الاسم تحت نفس الحساب الرئيسي', { name: 'مكرر' })
  const acc = await createChildAccount(tx, parent.id, input.name, { description: input.description, isGroup: input.isGroup, code: input.code })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Account',
    entityId: acc.id,
    entityLabel: `${acc.code} — ${acc.name}`,
    summary: `إضافة ${acc.isGroup ? 'حساب تجميعي' : 'حساب'} ${acc.code} «${acc.name}» تحت ${parent.code} «${parent.name}»`,
    after: acc,
  })
  return acc
}

export async function updateAccount(tx: Tx, ctx: Ctx, id: number, input: { name: string; description: string | null; isActive: boolean }) {
  const before = await tx.account.findUnique({ where: { id }, include: { cashAccount: true, chargeTypes: true, partnerCapital: true, partnerDrawings: true } })
  if (!before) throw new BusinessError('الحساب غير موجود')
  if (!input.isActive && before.isActive) {
    if (before.systemKey || before.isSystem) throw new BusinessError('حسابات النظام الأساسية لا تُعطّل')
    if (before.cashAccount || before.chargeTypes.length || before.partnerCapital || before.partnerDrawings) {
      throw new BusinessError('الحساب مرتبط بصندوق أو تصنيف ذمة أو شريك؛ عطّل الجهة المرتبطة من شاشتها')
    }
    const ids = before.isGroup
      ? (await tx.account.findMany({ where: { code: { startsWith: before.code } }, select: { id: true } })).map((a) => a.id)
      : [before.id]
    const [bal] = await tx.$queryRaw<{ net: string }[]>`SELECT COALESCE(SUM("debit" - "credit"), 0)::text AS net FROM "journal_lines" WHERE "accountId" IN (${Prisma.join(ids)})`
    if (!D(bal.net).isZero()) throw new BusinessError('لا يمكن تعطيل حساب رصيده غير صفري. انقل رصيده بقيد يدوي أولًا')
    if (before.isGroup && (await tx.account.count({ where: { parentId: before.id, isActive: true } }))) throw new BusinessError('عطّل الحسابات الفرعية أولًا')
  }
  const after = await tx.account.update({ where: { id }, data: { name: input.name.trim(), description: input.description, isActive: input.isActive } })
  await audit(tx, ctx, {
    action: before.isActive !== after.isActive ? 'status' : 'update',
    entityType: 'Account',
    entityId: id,
    entityLabel: `${after.code} — ${after.name}`,
    summary: before.isActive !== after.isActive ? `${after.isActive ? 'تفعيل' : 'تعطيل'} الحساب ${after.code} «${after.name}»` : undefined,
    before: { name: before.name, description: before.description, isActive: before.isActive },
    after: { name: after.name, description: after.description, isActive: after.isActive },
  })
  return after
}

// ---------------------------------------------------------------------
// القيود اليومية
// ---------------------------------------------------------------------

export interface JournalFilters {
  q?: string
  source?: string
  status?: 'posted' | 'reversed' | 'reversal'
  accountId?: number
  from?: DateOnly
  to?: DateOnly
  page?: number
  pageSize?: number
}

export async function listJournal(client: DbOrTx, f: JournalFilters) {
  const pageSize = f.pageSize ?? 50
  const and: Prisma.JournalEntryWhereInput[] = []
  if (f.source === 'AUTO') and.push({ sourceType: { not: 'MANUAL' } })
  else if (f.source) and.push({ sourceType: f.source })
  if (f.status === 'posted') and.push({ status: 'POSTED', reversalOfId: null })
  if (f.status === 'reversed') and.push({ status: 'REVERSED' })
  if (f.status === 'reversal') and.push({ reversalOfId: { not: null } })
  if (f.accountId) and.push({ lines: { some: { accountId: f.accountId } } })
  if (f.from) and.push({ date: { gte: fromDateOnly(f.from) } })
  if (f.to) and.push({ date: { lte: fromDateOnly(f.to) } })
  const q = f.q?.trim()
  if (q) and.push({ OR: [{ number: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] })
  const where = and.length ? { AND: and } : {}
  const [total, agg] = await Promise.all([client.journalEntry.count({ where }), client.journalEntry.aggregate({ where, _sum: { totalAmount: true } })])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, f.page ?? 1), pages)
  const rows = await client.journalEntry.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { createdBy: { select: { fullName: true } }, _count: { select: { lines: true } }, reversedBy: { select: { id: true, number: true } } },
  })
  return { rows, total, page, pages, pageSize, totalAmount: D(agg._sum.totalAmount ?? 0) }
}

export async function journalEntryDetail(client: DbOrTx, id: number) {
  return client.journalEntry.findUnique({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      academicYear: { select: { name: true, status: true } },
      reversalOf: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true, date: true } },
      lines: {
        orderBy: { lineOrder: 'asc' },
        include: {
          account: { select: { id: true, code: true, name: true } },
          student: { select: { id: true, fullName: true } },
          employee: { select: { id: true, fullName: true } },
          supplier: { select: { id: true, name: true } },
          contractor: { select: { id: true, name: true } },
          partner: { select: { id: true, name: true } },
        },
      },
    },
  })
}

export interface ManualLine {
  accountId: number
  debit: string | null
  credit: string | null
  description: string | null
}

/**
 * قيد يدوي (تسويات، إهلاك، إعادة تصنيف...). يُسمح فقط بالحسابات «الحرة»:
 * الصناديق وحسابات الأطراف والشركاء تتحرك من شاشاتها حتى تبقى كشوف الحساب مطابقة.
 */
export async function createManualEntry(tx: Tx, ctx: Ctx, input: { date: DateOnly; description: string; lines: ManualLine[] }) {
  const lines = input.lines.filter((l) => D(l.debit ?? 0).greaterThan(0) || D(l.credit ?? 0).greaterThan(0))
  if (lines.length < 2) throw new BusinessError('القيد يحتاج طرفين على الأقل (مدين ودائن)')
  for (const [i, l] of lines.entries()) {
    const debit = D(l.debit ?? 0)
    const credit = D(l.credit ?? 0)
    if (debit.greaterThan(0) && credit.greaterThan(0)) throw new BusinessError(`السطر ${i + 1}: أدخل مدينًا أو دائنًا، لا كليهما`)
    if (!(await isFreePostingAccount(tx, l.accountId))) {
      const acc = await tx.account.findUnique({ where: { id: l.accountId } })
      throw new BusinessError(`السطر ${i + 1}: الحساب «${acc?.name ?? l.accountId}» لا يُستخدم في القيود اليدوية (صندوق/بنك أو حساب طرف أو شريك أو تجميعي أو معطل)`)
    }
  }
  const totalDebit = sum(lines.map((l) => D(l.debit ?? 0)))
  const totalCredit = sum(lines.map((l) => D(l.credit ?? 0)))
  if (!totalDebit.equals(totalCredit)) {
    throw new BusinessError(`القيد غير متوازن: المدين ${totalDebit.toFixed(2)} والدائن ${totalCredit.toFixed(2)} (الفرق ${totalDebit.minus(totalCredit).abs().toFixed(2)})`)
  }
  const entry = await postEntry(tx, ctx, {
    date: input.date,
    description: input.description,
    sourceType: 'MANUAL',
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description ?? input.description })),
  })
  const accounts = await tx.account.findMany({ where: { id: { in: lines.map((l) => l.accountId) } }, select: { id: true, code: true, name: true } })
  const name = (id: number) => accounts.find((a) => a.id === id)
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'JournalEntry',
    entityId: entry.id,
    entityLabel: `قيد ${entry.number}`,
    summary: `قيد يدوي ${entry.number} بمبلغ ${totalDebit.toFixed(2)}: ${input.description}`,
    after: {
      number: entry.number,
      date: input.date,
      description: input.description,
      lines: lines.map((l) => ({ account: `${name(l.accountId)?.code} ${name(l.accountId)?.name}`, debit: l.debit ?? '0', credit: l.credit ?? '0', description: l.description })),
    },
  })
  return entry
}

/** عكس قيد يدوي بقيد عكسي (القيود الآلية تُلغى من مستنداتها). */
export async function reverseManualEntry(tx: Tx, ctx: Ctx, id: number, input: { date: DateOnly; reason: string }) {
  const entry = await tx.journalEntry.findUnique({ where: { id } })
  if (!entry) throw new BusinessError('القيد غير موجود')
  if (entry.sourceType !== 'MANUAL') throw new BusinessError('هذا قيد آلي ناتج عن مستند؛ ألغِ المستند نفسه (السند أو الذمة...) فيُعكس قيده تلقائيًا')
  if (entry.reversalOfId) throw new BusinessError('هذا قيد عكسي ولا يُعكس')
  if (input.date < toDateOnly(entry.date)) throw new BusinessError('تاريخ العكس لا يسبق تاريخ القيد الأصلي')
  const reversal = await reverseEntry(tx, ctx, entry.id, { date: input.date, description: `عكس القيد اليدوي ${entry.number} — ${input.reason}`, sourceType: 'MANUAL' })
  await audit(tx, ctx, {
    action: 'cancel',
    entityType: 'JournalEntry',
    entityId: entry.id,
    entityLabel: `قيد ${entry.number}`,
    summary: `عكس القيد اليدوي ${entry.number} بالقيد ${reversal.number} — السبب: ${input.reason}`,
  })
  return reversal
}

/** نطاق افتراضي: من بداية السنة الحالية حتى اليوم. */
export function defaultRange(year: { startDate: Date; endDate: Date } | null, today: DateOnly) {
  if (!year) return { from: addDays(today, -30), to: today }
  const start = toDateOnly(year.startDate)
  const end = toDateOnly(year.endDate)
  return { from: start, to: today < end ? (today < start ? end : today) : end }
}
