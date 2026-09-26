import 'server-only'
import type { Tx } from '../db'
import type { Ctx } from '../context'
import { BusinessError } from '../errors'
import { nextDocumentNumber } from '../numbering'
import { resolveOpenYear } from '../years'
import { D, round, sum, toDb, type MoneyLike } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'

/**
 * المحرك المحاسبي: كل مستند مالي يستدعي postEntry داخل معاملته.
 * - يرفض القيد غير المتوازن أو ذي الطرف الواحد
 * - يرفض الترحيل لحساب تجميعي أو معطل
 * - يرفض التاريخ داخل سنة مغلقة
 * - الإلغاء لا يحذف: reverseEntry ينشئ قيدًا عكسيًا مطابقًا
 */

export interface JournalLineInput {
  accountId: number
  debit?: MoneyLike
  credit?: MoneyLike
  description?: string | null
  studentId?: number | null
  employeeId?: number | null
  supplierId?: number | null
  contractorId?: number | null
  partnerId?: number | null
}

export interface PostEntryInput {
  date: DateOnly
  description: string
  sourceType: string
  sourceId?: number | null
  lines: JournalLineInput[]
  allowClosedYear?: boolean
  reversalOfId?: number
}

export async function postEntry(tx: Tx, ctx: Ctx, input: PostEntryInput) {
  const lines = input.lines
    .map((l) => {
      let debit = round(D(l.debit), 3)
      let credit = round(D(l.credit), 3)
      if (debit.isNegative() || credit.isNegative()) throw new Error('NEGATIVE_JOURNAL_LINE')
      // طرف بقيمتين: نحتفظ بالصافي فقط
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        const net = debit.minus(credit)
        debit = net.isPositive() ? net : D(0)
        credit = net.isNegative() ? net.abs() : D(0)
      }
      return { ...l, debit, credit }
    })
    .filter((l) => !(l.debit.isZero() && l.credit.isZero()))

  const totalDebit = sum(lines.map((l) => l.debit))
  const totalCredit = sum(lines.map((l) => l.credit))
  if (lines.length < 2 || totalDebit.isZero()) {
    throw new BusinessError('لا يمكن إنشاء قيد بدون مبلغ أو بطرف واحد')
  }
  if (!totalDebit.equals(totalCredit)) {
    throw new Error(`JOURNAL_UNBALANCED: debit ${totalDebit} credit ${totalCredit}`)
  }

  const year = await resolveOpenYear(tx, input.date, { allowClosed: input.allowClosedYear })

  const accountIds = [...new Set(lines.map((l) => l.accountId))]
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } })
  for (const id of accountIds) {
    const acc = accounts.find((a) => a.id === id)
    if (!acc) throw new BusinessError('حساب غير موجود في دليل الحسابات')
    if (acc.isGroup) throw new BusinessError(`لا يمكن الترحيل إلى الحساب التجميعي «${acc.name}»`)
    if (!acc.isActive) throw new BusinessError(`الحساب «${acc.name}» معطّل`)
  }

  const number = await nextDocumentNumber(tx, 'journal', input.date)
  const date = fromDateOnly(input.date)
  return tx.journalEntry.create({
    data: {
      number,
      date,
      academicYearId: year.id,
      description: input.description.slice(0, 500),
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      totalAmount: toDb(totalDebit),
      createdById: ctx.userId,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          date,
          debit: toDb(l.debit),
          credit: toDb(l.credit),
          description: l.description?.slice(0, 500) ?? null,
          lineOrder: i,
          studentId: l.studentId ?? null,
          employeeId: l.employeeId ?? null,
          supplierId: l.supplierId ?? null,
          contractorId: l.contractorId ?? null,
          partnerId: l.partnerId ?? null,
        })),
      },
    },
  })
}

/** عكس قيد: قيد جديد بنفس الأطراف معكوسة، والأصلي يُعلّم «معكوس» ولا يُحذف. */
export async function reverseEntry(
  tx: Tx,
  ctx: Ctx,
  entryId: number,
  options: { date: DateOnly; description?: string; sourceType?: string },
) {
  const original = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } })
  if (!original) throw new BusinessError('القيد غير موجود')
  if (original.status === 'REVERSED') throw new BusinessError(`القيد ${original.number} معكوس مسبقًا`)
  const reversal = await postEntry(tx, ctx, {
    date: options.date,
    description: options.description ?? `عكس القيد ${original.number}: ${original.description}`,
    sourceType: options.sourceType ?? 'REVERSAL',
    sourceId: original.sourceId,
    reversalOfId: original.id,
    lines: original.lines
      .sort((a, b) => a.lineOrder - b.lineOrder)
      .map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description,
        studentId: l.studentId,
        employeeId: l.employeeId,
        supplierId: l.supplierId,
        contractorId: l.contractorId,
        partnerId: l.partnerId,
      })),
  })
  await tx.journalEntry.update({ where: { id: original.id }, data: { status: 'REVERSED' } })
  return reversal
}
