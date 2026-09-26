import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { createCharge } from '@/server/services/charges'
import {
  applyStudentCredit,
  bounceCheque,
  cancelReceipt,
  clearCheque,
  createStudentReceipt,
  openInstallments,
  reallocateReceipt,
  studentCredit,
} from '@/server/services/receipts'
import { accountTotals } from '@/server/ledger/balances'
import { accountIdByKey } from '@/server/ledger/accounts'
import { testCtx } from './support/helpers'
import { arBalance, chargeType, currentYear, makeStudent, trialBalanceDiff, yearDate } from './support/fixtures'

async function setupStudentWith8x600() {
  const student = await makeStudent()
  const year = await currentYear()
  const type = await chargeType()
  const date = await yearDate(2)
  const charge = await transaction((tx) =>
    createCharge(tx, testCtx(), {
      studentId: student.id,
      chargeTypeId: type.id,
      academicYearId: year.id,
      date,
      grossAmount: '4800',
      installments: { count: 8, firstDueDate: date },
    }),
  )
  return { student, charge, date }
}

async function cashbox() {
  return db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
}

async function installments(chargeId: number) {
  return db.installment.findMany({ where: { chargeId, status: { not: 'CANCELLED' } }, orderBy: { number: 'asc' } })
}

describe('receipts', () => {
  it('records a partial payment, auto-allocating oldest first, and updates everything', async () => {
    const { student, charge, date } = await setupStudentWith8x600()
    const box = await cashbox()
    const cashBefore = (await accountTotals(db, box.glAccountId)).net
    const receipt = await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), {
        kind: 'STUDENT',
        studentId: student.id,
        date,
        amount: '1000',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
      }),
    )
    expect(receipt.number).toMatch(/^REC-\d{4}-\d{6}$/)
    const inst = await installments(charge.id)
    expect(inst[0].status).toBe('PAID')
    expect(inst[1].paidAmount.toString()).toBe('400')
    expect(inst[1].status).toBe('PARTIAL')
    expect(inst[2].status).toBe('UNPAID')
    const c = await db.charge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(c.paidAmount.toString()).toBe('1000')
    expect(c.paymentStatus).toBe('PARTIAL')
    expect((await arBalance(student.id)).toString()).toBe('3800')
    const cashAfter = (await accountTotals(db, box.glAccountId)).net
    expect(cashAfter.minus(cashBefore).toString()).toBe('1000')
    const log = await db.auditLog.findFirst({ where: { entityType: 'Receipt', entityId: String(receipt.id) } })
    expect(log).not.toBeNull()
  })

  it('pays a 500 installment partially: 300 paid, 200 remaining', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(2)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: type.id, academicYearId: year.id, date, grossAmount: '500' }),
    )
    const [inst] = await installments(charge.id)
    const box = await cashbox()
    await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), {
        kind: 'STUDENT',
        studentId: student.id,
        date,
        amount: '300',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
        allocations: [{ installmentId: inst.id, amount: '300' }],
      }),
    )
    const after = await db.installment.findUniqueOrThrow({ where: { id: inst.id } })
    expect(after.amount.toString()).toBe('500')
    expect(after.paidAmount.toString()).toBe('300')
    expect(after.status).toBe('PARTIAL')
  })

  it('requires confirmation for overpayment and records the excess as credit', async () => {
    const { student, date } = await setupStudentWith8x600()
    const box = await cashbox()
    const input = { kind: 'STUDENT' as const, studentId: student.id, date, amount: '5000', paymentMethod: 'CASH' as const, cashAccountId: box.id }
    await expect(transaction((tx) => createStudentReceipt(tx, testCtx(), input))).rejects.toThrow(/رصيدًا دائنًا/)
    await transaction((tx) => createStudentReceipt(tx, testCtx(), { ...input, confirmCredit: true }))
    expect((await studentCredit(db, student.id)).toString()).toBe('200')
    expect((await arBalance(student.id)).toString()).toBe('-200')
  })

  it('distributes one family payment across siblings (books 300 + uniform 200 + tuition 500)', async () => {
    const phone = `05${Date.now().toString().slice(-8)}`
    const a = await makeStudent({ phone })
    const b = await makeStudent({ phone })
    expect(b.guardianId).toBe(a.guardianId)
    const year = await currentYear()
    const date = await yearDate(2)
    const [tBooks, tUniform, tTuition] = await Promise.all([chargeTypeOf('الكتب'), chargeTypeOf('الزي المدرسي'), chargeTypeOf('القسط الدراسي')])
    const books = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: a.id, chargeTypeId: tBooks.id, academicYearId: year.id, date, grossAmount: '300' }),
    )
    const uniform = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: a.id, chargeTypeId: tUniform.id, academicYearId: year.id, date, grossAmount: '200' }),
    )
    const tuition = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: b.id, chargeTypeId: tTuition.id, academicYearId: year.id, date, grossAmount: '500' }),
    )
    const box = await cashbox()
    const [ib] = await installments(books.id)
    const [iu] = await installments(uniform.id)
    const [it] = await installments(tuition.id)
    const r = await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), {
        kind: 'FAMILY',
        guardianId: a.guardianId!,
        date,
        amount: '1000',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
        allocations: [
          { installmentId: ib.id, amount: '300' },
          { installmentId: iu.id, amount: '200' },
          { installmentId: it.id, amount: '500' },
        ],
      }),
    )
    expect((await arBalance(a.id)).toString()).toBe('0')
    expect((await arBalance(b.id)).toString()).toBe('0')
    const lines = await db.journalLine.findMany({ where: { entryId: r.journalEntryId! } })
    expect(lines.filter((l) => l.studentId === a.id).reduce((s, l) => s + Number(l.credit), 0)).toBe(500)
    expect(lines.filter((l) => l.studentId === b.id).reduce((s, l) => s + Number(l.credit), 0)).toBe(500)
  })

  it('cancelling a receipt restores installments and balances', async () => {
    const { student, charge, date } = await setupStudentWith8x600()
    const box = await cashbox()
    const r = await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), { kind: 'STUDENT', studentId: student.id, date, amount: '1200', paymentMethod: 'CASH', cashAccountId: box.id }),
    )
    await transaction((tx) => cancelReceipt(tx, testCtx(), r.id, 'إدخال خاطئ'))
    const inst = await installments(charge.id)
    expect(inst.every((i) => i.status === 'UNPAID' && i.paidAmount.toString() === '0')).toBe(true)
    expect((await arBalance(student.id)).toString()).toBe('4800')
    const after = await db.receipt.findUniqueOrThrow({ where: { id: r.id } })
    expect(after.status).toBe('CANCELLED')
    expect(after.cancelReason).toBe('إدخال خاطئ')
    await expect(db.receipt.delete({ where: { id: r.id } })).rejects.toThrow()
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('handles cheque lifecycle: portfolio → cleared → bounced', async () => {
    const { student, charge, date } = await setupStudentWith8x600()
    const portfolio = await accountIdByKey(db, 'CHEQUES_UNDER_COLLECTION')
    const bankGroup = await db.account.findUniqueOrThrow({ where: { systemKey: 'BANK_GROUP' } })
    const bankGl = await db.account.create({ data: { code: `112${Date.now().toString().slice(-6)}`, name: 'بنك اختبار', type: 'ASSET', parentId: bankGroup.id } })
    const bank = await db.cashAccount.create({ data: { name: `بنك اختبار ${Date.now()}`, type: 'BANK', glAccountId: bankGl.id } })
    const portfolioBefore = (await accountTotals(db, portfolio)).net
    const r = await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), {
        kind: 'STUDENT',
        studentId: student.id,
        date,
        amount: '600',
        paymentMethod: 'CHEQUE',
        cheque: { number: 'CHQ-1', bankName: 'بنك فلسطين', dueDate: date },
      }),
    )
    const cheque = await db.cheque.findUniqueOrThrow({ where: { receiptId: r.id } })
    expect(cheque.status).toBe('IN_PORTFOLIO')
    expect((await accountTotals(db, portfolio)).net.minus(portfolioBefore).toString()).toBe('600')
    await transaction((tx) => clearCheque(tx, testCtx(), cheque.id, { bankAccountId: bank.id, date }))
    expect((await accountTotals(db, bank.glAccountId)).net.toString()).toBe('600')
    expect((await accountTotals(db, portfolio)).net.minus(portfolioBefore).toString()).toBe('0')
    await transaction((tx) => bounceCheque(tx, testCtx(), cheque.id, 'رصيد غير كافٍ'))
    expect((await accountTotals(db, bank.glAccountId)).net.toString()).toBe('0')
    expect((await arBalance(student.id)).toString()).toBe('4800')
    const inst = await installments(charge.id)
    expect(inst[0].status).toBe('UNPAID')
    expect((await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } })).status).toBe('BOUNCED')
  })

  it('applies student credit to new charges without a journal entry', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const date = await yearDate(2)
    const box = await cashbox()
    await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), { kind: 'STUDENT', studentId: student.id, date, amount: '250', paymentMethod: 'CASH', cashAccountId: box.id, confirmCredit: true }),
    )
    expect((await studentCredit(db, student.id)).toString()).toBe('250')
    const tBooks = await chargeType('الكتب')
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: tBooks.id, academicYearId: year.id, date, grossAmount: '200' }),
    )
    const entriesBefore = await db.journalEntry.count()
    await transaction((tx) => applyStudentCredit(tx, testCtx(), student.id))
    expect(await db.journalEntry.count()).toBe(entriesBefore)
    expect((await studentCredit(db, student.id)).toString()).toBe('50')
    const c = await db.charge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(c.paymentStatus).toBe('PAID')
    expect((await arBalance(student.id)).toString()).toBe('-50')
  })

  it('reallocates a receipt between charges keeping the ledger unchanged', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const date = await yearDate(2)
    const box = await cashbox()
    const [tBooks, tUniform] = await Promise.all([chargeType('الكتب'), chargeType('الزي المدرسي')])
    const c1 = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: tBooks.id, academicYearId: year.id, date, grossAmount: '300' }),
    )
    const c2 = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: tUniform.id, academicYearId: year.id, date, grossAmount: '300' }),
    )
    const r = await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), { kind: 'STUDENT', studentId: student.id, date, amount: '300', paymentMethod: 'CASH', cashAccountId: box.id }),
    )
    const open = await openInstallments(db, [student.id])
    const target = open.find((o) => o.chargeId === c2.id)!
    await transaction((tx) => reallocateReceipt(tx, testCtx(), r.id, [{ installmentId: target.id, amount: '300' }]))
    expect((await db.charge.findUniqueOrThrow({ where: { id: c1.id } })).paymentStatus).toBe('UNPAID')
    expect((await db.charge.findUniqueOrThrow({ where: { id: c2.id } })).paymentStatus).toBe('PAID')
    expect((await arBalance(student.id)).toString()).toBe('300')
  })

  it('prevents double allocation under concurrency', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const date = await yearDate(2)
    const box = await cashbox()
    const tBooks = await chargeType('الكتب')
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: tBooks.id, academicYearId: year.id, date, grossAmount: '100' }),
    )
    const [inst] = await installments(charge.id)
    const pay = () =>
      transaction((tx) =>
        createStudentReceipt(tx, testCtx(), {
          kind: 'STUDENT',
          studentId: student.id,
          date,
          amount: '100',
          paymentMethod: 'CASH',
          cashAccountId: box.id,
          allocations: [{ installmentId: inst.id, amount: '100' }],
        }),
      )
    const results = await Promise.allSettled([pay(), pay()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const after = await db.installment.findUniqueOrThrow({ where: { id: inst.id } })
    expect(after.paidAmount.toString()).toBe('100')
    expect((await arBalance(student.id)).toString()).toBe('0')
  })
})

async function chargeTypeOf(name: string) {
  return db.chargeType.findFirstOrThrow({ where: { name } })
}
