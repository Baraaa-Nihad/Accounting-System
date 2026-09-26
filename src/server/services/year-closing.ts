import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { accountIdByKey } from '../ledger/accounts'
import { postEntry, reverseEntry, type JournalLineInput } from '../ledger/posting'
import { NOT_CLOSING_SQL } from '../ledger/sources'
import { getSettings, today as todayOf } from '../settings'
import { setCurrentYear } from './school'
import { D, round, sum } from '@/lib/money'
import { toDateOnly } from '@/lib/dates'
import type Decimal from 'decimal.js'

/**
 * إغلاق السنة المالية وإعادة فتحها (docs/05-workflows.md §5.23):
 * قيد إقفال يصفّر الإيرادات والمصروفات للسنة في الأرباح المحتجزة، واختياريًا
 * توزيع صافي الربح على جاري الشركاء حسب نسبهم. إعادة الفتح تعكس قيود الإقفال.
 */

/** أرصدة حسابات الإيرادات والمصروفات داخل فترة السنة (دون قيود الإقفال). */
async function yearNominalBalances(client: DbOrTx, start: Date, end: Date) {
  const rows = await client.$queryRaw<{ id: number; code: string; name: string; type: string; net: string }[]>`
    SELECT a."id", a."code", a."name", a."type"::text AS type, COALESCE(SUM(jl."debit" - jl."credit"), 0)::text AS net
    FROM "journal_lines" jl
    JOIN "journal_entries" je ON je."id" = jl."entryId"
    JOIN "accounts" a ON a."id" = jl."accountId"
    WHERE a."type" IN ('REVENUE', 'EXPENSE') AND jl."date" >= ${start} AND jl."date" <= ${end} AND ${NOT_CLOSING_SQL}
    GROUP BY a."id" ORDER BY a."code"`
  return rows.map((r) => ({ ...r, net: D(r.net) })).filter((r) => !r.net.isZero())
}

/** توزيع مبلغ على الشركاء حسب النسب (يبقى الكسر الناتج عن التقريب في الأرباح المحتجزة). */
function partnerShares(total: Decimal, partners: { id: number; name: string; ownershipPercent: Prisma.Decimal; drawingsAccountId: number | null }[], decimals: number) {
  return partners
    .filter((p) => p.drawingsAccountId && D(p.ownershipPercent).greaterThan(0))
    .map((p) => ({ partner: p, amount: round(total.times(D(p.ownershipPercent)).dividedBy(100), decimals) }))
    .filter((s) => !s.amount.isZero())
}

export async function closingPreview(client: DbOrTx, yearId: number) {
  const year = await client.academicYear.findUnique({ where: { id: yearId } })
  if (!year) throw new BusinessError('السنة غير موجودة')
  const [balances, draftRuns, cheques, next, partners, settings, today, closeEntries] = await Promise.all([
    yearNominalBalances(client, year.startDate, year.endDate),
    client.payrollRun.count({ where: { status: 'DRAFT', postingDate: { gte: year.startDate, lte: year.endDate } } }),
    client.cheque.count({ where: { status: 'IN_PORTFOLIO', direction: 'INCOMING' } }),
    client.academicYear.findFirst({ where: { startDate: { gt: year.endDate } }, orderBy: { startDate: 'asc' } }),
    client.partner.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    getSettings(client),
    todayOf(client),
    client.journalEntry.findMany({ where: { sourceType: 'YEAR_CLOSE', sourceId: yearId }, orderBy: { id: 'asc' }, select: { id: true, number: true, status: true, date: true, totalAmount: true } }),
  ])
  const revenue = sum(balances.filter((b) => b.type === 'REVENUE').map((b) => b.net.negated()))
  const expenses = sum(balances.filter((b) => b.type === 'EXPENSE').map((b) => b.net))
  const netIncome = revenue.minus(expenses)
  const warnings: string[] = []
  if (toDateOnly(year.endDate) >= today) warnings.push(`السنة لم تنتهِ بعد (تنتهي ${toDateOnly(year.endDate)}). بعد الإغلاق لن يمكن تسجيل أي حركة بتاريخ داخلها.`)
  if (draftRuns) warnings.push(`يوجد ${draftRuns} مسير رواتب غير معتمد داخل السنة؛ اعتمده أو ألغِه قبل الإغلاق حتى تدخل الرواتب في نتيجة السنة.`)
  if (cheques) warnings.push(`يوجد ${cheques} شيك وارد في الحافظة لم يُحصّل بعد (يمكن تحصيله بعد الإغلاق بتاريخ السنة الجديدة).`)
  if (!next) warnings.push('لا توجد سنة دراسية بعد هذه السنة. أنشئ السنة الجديدة أولًا حتى تستمر الحركات بعد الإغلاق.')
  const pct = sum(partners.map((p) => D(p.ownershipPercent)))
  return {
    year: { id: year.id, name: year.name, startDate: toDateOnly(year.startDate), endDate: toDateOnly(year.endDate), status: year.status, isCurrent: year.isCurrent, closedAt: year.closedAt },
    balances,
    revenue,
    expenses,
    netIncome,
    warnings,
    next: next ? { id: next.id, name: next.name, status: next.status, isCurrent: next.isCurrent } : null,
    partners: partnerShares(netIncome, partners, settings.finance.decimals).map((s) => ({ id: s.partner.id, name: s.partner.name, percent: D(s.partner.ownershipPercent), amount: s.amount })),
    partnersPercent: pct,
    closeEntries,
  }
}

export async function closeYear(tx: Tx, ctx: Ctx, yearId: number, options: { distribute: boolean; makeNextCurrent: boolean }) {
  // قفل صف السنة لمنع إغلاقين متزامنين
  await tx.$queryRaw`SELECT "id" FROM "academic_years" WHERE "id" = ${yearId} FOR UPDATE`
  const year = await tx.academicYear.findUnique({ where: { id: yearId } })
  if (!year) throw new BusinessError('السنة غير موجودة')
  if (year.status === 'CLOSED') throw new BusinessError(`السنة ${year.name} مغلقة مسبقًا`)
  const { finance } = await getSettings(tx)
  const end = toDateOnly(year.endDate)
  const balances = await yearNominalBalances(tx, year.startDate, year.endDate)
  const retained = await accountIdByKey(tx, 'RETAINED_EARNINGS')
  // صافي الربح = الدائن − المدين لحسابات النتيجة
  const netIncome = sum(balances.map((b) => b.net)).negated()
  let closingEntry: { id: number; number: string } | null = null
  if (balances.length) {
    const lines: JournalLineInput[] = balances.map((b) => (b.net.isPositive() ? { accountId: b.id, credit: b.net } : { accountId: b.id, debit: b.net.abs() }))
    if (!netIncome.isZero()) lines.push(netIncome.isPositive() ? { accountId: retained, credit: netIncome } : { accountId: retained, debit: netIncome.abs() })
    closingEntry = await postEntry(tx, ctx, {
      date: end,
      description: `قيد إقفال السنة ${year.name}: ${netIncome.isNegative() ? 'صافي خسارة' : 'صافي ربح'} ${netIncome.abs().toFixed(finance.decimals)} إلى الأرباح المحتجزة`,
      sourceType: 'YEAR_CLOSE',
      sourceId: year.id,
      lines,
    })
  }
  let distributed = D(0)
  const notes: string[] = []
  if (options.distribute && !netIncome.isZero()) {
    const partners = await tx.partner.findMany({ where: { isActive: true } })
    const shares = partnerShares(netIncome.abs(), partners, finance.decimals)
    if (shares.length) {
      const total = sum(shares.map((s) => s.amount))
      const profit = netIncome.isPositive()
      await postEntry(tx, ctx, {
        date: end,
        description: `توزيع ${profit ? 'صافي ربح' : 'صافي خسارة'} السنة ${year.name} على جاري الشركاء حسب نسب الملكية`,
        sourceType: 'YEAR_CLOSE',
        sourceId: year.id,
        lines: [
          profit ? { accountId: retained, debit: total } : { accountId: retained, credit: total },
          ...shares.map((s) =>
            profit
              ? { accountId: s.partner.drawingsAccountId!, credit: s.amount, partnerId: s.partner.id, description: `حصة ${s.partner.name} (${D(s.partner.ownershipPercent).toString()}%)` }
              : { accountId: s.partner.drawingsAccountId!, debit: s.amount, partnerId: s.partner.id, description: `حصة ${s.partner.name} (${D(s.partner.ownershipPercent).toString()}%)` },
          ),
        ],
      })
      distributed = total
      notes.push(...shares.map((s) => `${s.partner.name}: ${s.amount.toFixed(finance.decimals)}`))
    }
  }
  await tx.academicYear.update({ where: { id: year.id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: ctx.userId, closingEntryId: closingEntry?.id ?? null } })
  let movedCurrent: string | null = null
  if (options.makeNextCurrent && year.isCurrent) {
    const next = await tx.academicYear.findFirst({ where: { startDate: { gt: year.endDate }, status: 'OPEN' }, orderBy: { startDate: 'asc' } })
    if (next) {
      await setCurrentYear(tx, ctx, next.id)
      movedCurrent = next.name
    }
  }
  await audit(tx, ctx, {
    action: 'close_year',
    entityType: 'AcademicYear',
    entityId: year.id,
    entityLabel: year.name,
    summary: `إغلاق السنة ${year.name}: ${netIncome.isNegative() ? 'صافي خسارة' : 'صافي ربح'} ${netIncome.abs().toFixed(finance.decimals)}${closingEntry ? ` بقيد ${closingEntry.number}` : ''}${distributed.greaterThan(0) ? `، ووُزع ${distributed.toFixed(finance.decimals)} على الشركاء (${notes.join('، ')})` : ''}${movedCurrent ? `، والسنة الحالية أصبحت ${movedCurrent}` : ''}`,
    after: { netIncome: netIncome.toString(), closingEntry: closingEntry?.number ?? null, distributed: distributed.toString() },
  })
  return { netIncome, closingEntry, distributed }
}

/** إعادة فتح سنة مغلقة (لمدير النظام فقط، مع سبب): تُعكس قيود الإقفال بنفس تاريخها. */
export async function reopenYear(tx: Tx, ctx: Ctx, yearId: number, reason: string) {
  await tx.$queryRaw`SELECT "id" FROM "academic_years" WHERE "id" = ${yearId} FOR UPDATE`
  const year = await tx.academicYear.findUnique({ where: { id: yearId } })
  if (!year) throw new BusinessError('السنة غير موجودة')
  if (year.status !== 'CLOSED') throw new BusinessError(`السنة ${year.name} مفتوحة`)
  await tx.academicYear.update({ where: { id: year.id }, data: { status: 'OPEN', closedAt: null, closedById: null, closingEntryId: null } })
  const entries = await tx.journalEntry.findMany({ where: { sourceType: 'YEAR_CLOSE', sourceId: year.id, status: 'POSTED', reversalOfId: null }, orderBy: { id: 'desc' } })
  const reversed: string[] = []
  for (const e of entries) {
    const r = await reverseEntry(tx, ctx, e.id, { date: toDateOnly(year.endDate), description: `عكس ${e.description} (إعادة فتح السنة) — ${reason}`, sourceType: 'YEAR_REOPEN' })
    reversed.push(`${e.number} ← ${r.number}`)
  }
  await audit(tx, ctx, {
    action: 'reopen_year',
    entityType: 'AcademicYear',
    entityId: year.id,
    entityLabel: year.name,
    summary: `إعادة فتح السنة ${year.name}${reversed.length ? ` وعكس قيود الإقفال (${reversed.join('، ')})` : ''} — السبب: ${reason}`,
  })
  return { reversed }
}
