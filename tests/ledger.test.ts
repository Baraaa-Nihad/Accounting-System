import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { postEntry, reverseEntry } from '@/server/ledger/posting'
import { accountIdByKey } from '@/server/ledger/accounts'
import { accountTotals } from '@/server/ledger/balances'
import { nextDocumentNumber } from '@/server/numbering'
import { testCtx } from './support/helpers'
import { getCurrentYear } from '@/server/years'
import { toDateOnly } from '@/lib/dates'

async function currentDate() {
  const y = await getCurrentYear(db)
  return toDateOnly(y!.startDate)
}

describe('ledger posting', () => {
  it('posts a balanced entry and reverses it', async () => {
    const date = await currentDate()
    const cash = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    const opening = await accountIdByKey(db, 'OPENING_BALANCE')
    const before = (await accountTotals(db, cash.glAccountId)).net
    const entry = await transaction((tx) =>
      postEntry(tx, testCtx(), {
        date,
        description: 'رصيد افتتاحي للصندوق',
        sourceType: 'OPENING',
        lines: [
          { accountId: cash.glAccountId, debit: 1000 },
          { accountId: opening, credit: 1000 },
        ],
      }),
    )
    expect(entry.number).toMatch(/^JE-\d{4}-\d{6}$/)
    let totals = await accountTotals(db, cash.glAccountId)
    expect(totals.net.minus(before).toFixed(2)).toBe('1000.00')

    await transaction((tx) => reverseEntry(tx, testCtx(), entry.id, { date }))
    totals = await accountTotals(db, cash.glAccountId)
    expect(totals.net.minus(before).toFixed(2)).toBe('0.00')
    const original = await db.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(original.status).toBe('REVERSED')
    await expect(transaction((tx) => reverseEntry(tx, testCtx(), entry.id, { date }))).rejects.toThrow()
  })

  it('rejects unbalanced entries in code and in the database', async () => {
    const date = await currentDate()
    const cash = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    const opening = await accountIdByKey(db, 'OPENING_BALANCE')
    await expect(
      transaction((tx) =>
        postEntry(tx, testCtx(), {
          date,
          description: 'غير متوازن',
          sourceType: 'MANUAL',
          lines: [
            { accountId: cash.glAccountId, debit: 100 },
            { accountId: opening, credit: 90 },
          ],
        }),
      ),
    ).rejects.toThrow(/JOURNAL_UNBALANCED/)

    // تجاوز الكود والكتابة مباشرة: تريجر القاعدة يرفض عند COMMIT
    await expect(
      db.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({
          data: { number: 'TEST-UNBALANCED', date: new Date(`${date}T00:00:00Z`), description: 'x', sourceType: 'MANUAL', totalAmount: '100' },
        })
        await tx.journalLine.create({ data: { entryId: e.id, accountId: cash.glAccountId, date: new Date(`${date}T00:00:00Z`), debit: '100' } })
        await tx.journalLine.create({ data: { entryId: e.id, accountId: opening, date: new Date(`${date}T00:00:00Z`), credit: '99' } })
      }),
    ).rejects.toThrow()
    expect(await db.journalEntry.findUnique({ where: { number: 'TEST-UNBALANCED' } })).toBeNull()
  })

  it('refuses posting to group accounts', async () => {
    const date = await currentDate()
    const group = await accountIdByKey(db, 'CASH_GROUP')
    const opening = await accountIdByKey(db, 'OPENING_BALANCE')
    await expect(
      transaction((tx) =>
        postEntry(tx, testCtx(), {
          date,
          description: 'مجموعة',
          sourceType: 'MANUAL',
          lines: [
            { accountId: group, debit: 10 },
            { accountId: opening, credit: 10 },
          ],
        }),
      ),
    ).rejects.toThrow(/التجميعي/)
  })

  it('protects ledger and audit rows from modification', async () => {
    const line = await db.journalLine.findFirstOrThrow()
    await expect(db.journalLine.update({ where: { id: line.id }, data: { debit: '5' } })).rejects.toThrow()
    await expect(db.journalLine.delete({ where: { id: line.id } })).rejects.toThrow()
    const entry = await db.journalEntry.findFirstOrThrow()
    await expect(db.journalEntry.update({ where: { id: entry.id }, data: { description: 'تلاعب' } })).rejects.toThrow()
    const log = await db.auditLog.create({ data: { action: 'test', entityType: 'System' } })
    await expect(db.auditLog.update({ where: { id: log.id }, data: { action: 'x' } })).rejects.toThrow()
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow()
  })

  it('refuses dates outside defined academic years', async () => {
    const cash = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    const opening = await accountIdByKey(db, 'OPENING_BALANCE')
    await expect(
      transaction((tx) =>
        postEntry(tx, testCtx(), {
          date: '1990-01-01',
          description: 'خارج السنوات',
          sourceType: 'MANUAL',
          lines: [
            { accountId: cash.glAccountId, debit: 10 },
            { accountId: opening, credit: 10 },
          ],
        }),
      ),
    ).rejects.toThrow(/لا يقع ضمن أي سنة/)
  })
})

describe('numbering', () => {
  it('is sequential and unique under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => transaction((tx) => nextDocumentNumber(tx, 'receipt', '2031-05-01'))),
    )
    const serials = results.map((r) => Number(r.split('-')[2])).sort((a, b) => a - b)
    expect(new Set(results).size).toBe(10)
    expect(serials).toEqual(Array.from({ length: 10 }, (_, i) => serials[0] + i))
    expect(results[0]).toMatch(/^REC-2031-\d{6}$/)
  })
  it('does not consume a number when the transaction fails', async () => {
    const before = await transaction((tx) => nextDocumentNumber(tx, 'voucher', '2032-01-01'))
    await expect(
      transaction(async (tx) => {
        await nextDocumentNumber(tx, 'voucher', '2032-01-01')
        throw new Error('فشل')
      }),
    ).rejects.toThrow()
    const after = await transaction((tx) => nextDocumentNumber(tx, 'voucher', '2032-01-01'))
    expect(Number(after.split('-')[2])).toBe(Number(before.split('-')[2]) + 1)
  })
})
