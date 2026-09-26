import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { BusinessError } from '@/server/errors'
import { cancelTransfer, cashAccountsSummary, createCashAccount, createTransfer } from '@/server/services/treasury'
import { cancelVoucher, createVoucher } from '@/server/services/vouchers'
import {
  adjustContractorJob,
  cancelSupplierBill,
  createContractorJob,
  createSupplierBill,
  saveContractor,
  saveSupplier,
  setJobStatus,
  supplierBalance,
} from '@/server/services/parties'
import { saveCategoryAccount } from '@/server/services/categories'
import { createStudentReceipt, studentCredit } from '@/server/services/receipts'
import { accountTotals } from '@/server/ledger/balances'
import { accountIdByKey } from '@/server/ledger/accounts'
import { testCtx } from './support/helpers'
import { arBalance, makeStudent, trialBalanceDiff, yearDate } from './support/fixtures'

let seq = 0
function uniq(prefix: string) {
  seq++
  return `${prefix} ${Date.now()}-${seq}-${Math.floor(Math.random() * 10000)}`
}

async function newCashbox(opening: string, type: 'CASHBOX' | 'BANK' = 'CASHBOX') {
  const date = await yearDate(1)
  return transaction((tx) =>
    createCashAccount(tx, testCtx(), { name: uniq(type === 'CASHBOX' ? 'صندوق' : 'بنك'), type, openingBalance: opening, openingDate: date }),
  )
}

async function balanceOf(cashAccountId: number) {
  const ca = await db.cashAccount.findUniqueOrThrow({ where: { id: cashAccountId } })
  return (await accountTotals(db, ca.glAccountId)).net.toString()
}

async function expenseCategory() {
  return transaction((tx) => saveCategoryAccount(tx, testCtx(), { kind: 'EXPENSE', name: uniq('مصروف'), isActive: true }))
}

describe('treasury', () => {
  it('creates a cash account with an opening balance posted against opening equity', async () => {
    const box = await newCashbox('2500')
    expect(await balanceOf(box.id)).toBe('2500')
    const gl = await db.account.findUniqueOrThrow({ where: { id: box.glAccountId } })
    const parent = await db.account.findUniqueOrThrow({ where: { id: gl.parentId! } })
    expect(parent.systemKey).toBe('CASH_GROUP')
    const [summary] = (await cashAccountsSummary(db)).filter((s) => s.id === box.id)
    expect(summary.opening).toBe('2500')
    expect(summary.balance).toBe('2500')
  })

  it('transfers between accounts, rejects overdrafts, and cancellation restores balances', async () => {
    const a = await newCashbox('1000')
    const b = await newCashbox('0', 'BANK')
    const date = await yearDate(3)
    const t = await transaction((tx) => createTransfer(tx, testCtx(), { date, fromAccountId: a.id, toAccountId: b.id, amount: '600' }))
    expect(t.number).toMatch(/^TRF-\d{4}-\d{6}$/)
    expect(await balanceOf(a.id)).toBe('400')
    expect(await balanceOf(b.id)).toBe('600')

    await expect(transaction((tx) => createTransfer(tx, testCtx(), { date, fromAccountId: a.id, toAccountId: b.id, amount: '400.01' }))).rejects.toThrow(
      BusinessError,
    )
    await expect(transaction((tx) => createTransfer(tx, testCtx(), { date, fromAccountId: a.id, toAccountId: a.id, amount: '1' }))).rejects.toThrow(BusinessError)

    const [sa] = (await cashAccountsSummary(db)).filter((s) => s.id === a.id)
    expect(sa.transfersOut).toBe('600')

    await transaction((tx) => cancelTransfer(tx, testCtx(), t.id, 'خطأ في الإدخال'))
    expect(await balanceOf(a.id)).toBe('1000')
    expect(await balanceOf(b.id)).toBe('0')
    const cancelled = await db.cashTransfer.findUniqueOrThrow({ where: { id: t.id } })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.reversalEntryId).not.toBeNull()
  })
})

describe('payment vouchers', () => {
  it('records an expense voucher and cancelling it reverses the effect', async () => {
    const box = await newCashbox('900')
    const cat = await expenseCategory()
    const date = await yearDate(4)
    const v = await transaction((tx) =>
      createVoucher(tx, testCtx(), {
        kind: 'EXPENSE',
        date,
        amount: '350.5',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
        expenseAccountId: cat.id,
        payeeName: 'شركة الكهرباء',
      }),
    )
    expect(v.number).toMatch(/^PAY-\d{4}-\d{6}$/)
    expect(await balanceOf(box.id)).toBe('549.5')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('350.5')
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: v.journalEntryId! }, include: { lines: true } })
    expect(entry.lines).toHaveLength(2)

    await transaction((tx) => cancelVoucher(tx, testCtx(), v.id, 'مكرر'))
    expect(await balanceOf(box.id)).toBe('900')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('0')
    const log = await db.auditLog.findFirst({ where: { entityType: 'PaymentVoucher', entityId: String(v.id), action: 'cancel' } })
    expect(log?.summary).toContain('مكرر')
  })

  it('refuses to pay more than the available balance', async () => {
    const box = await newCashbox('100')
    const cat = await expenseCategory()
    const date = await yearDate(4)
    const err = await transaction((tx) =>
      createVoucher(tx, testCtx(), { kind: 'EXPENSE', date, amount: '100.01', paymentMethod: 'CASH', cashAccountId: box.id, expenseAccountId: cat.id, payeeName: 'x' }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(BusinessError)
    expect((err as BusinessError).fieldErrors?.amount).toBeTruthy()
    expect(await balanceOf(box.id)).toBe('100')
  })

  it('two concurrent vouchers cannot overdraw the same cashbox', async () => {
    const box = await newCashbox('500')
    const cat = await expenseCategory()
    const date = await yearDate(4)
    const pay = () =>
      transaction((tx) =>
        createVoucher(tx, testCtx(), { kind: 'EXPENSE', date, amount: '400', paymentMethod: 'CASH', cashAccountId: box.id, expenseAccountId: cat.id, payeeName: 'x' }),
      )
    const results = await Promise.allSettled([pay(), pay()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balanceOf(box.id)).toBe('100')
  })

  it('issues an outgoing cheque only from a bank account', async () => {
    const box = await newCashbox('1000')
    const bank = await newCashbox('1000', 'BANK')
    const cat = await expenseCategory()
    const date = await yearDate(5)
    const base = { kind: 'EXPENSE' as const, date, amount: '200', paymentMethod: 'CHEQUE' as const, expenseAccountId: cat.id, payeeName: 'مطبعة' }
    await expect(transaction((tx) => createVoucher(tx, testCtx(), { ...base, cashAccountId: box.id, cheque: { number: '77', dueDate: date } }))).rejects.toThrow(
      BusinessError,
    )
    const v = await transaction((tx) => createVoucher(tx, testCtx(), { ...base, cashAccountId: bank.id, cheque: { number: '77', dueDate: date } }))
    const cheque = await db.cheque.findUniqueOrThrow({ where: { voucherId: v.id } })
    expect(cheque.direction).toBe('OUTGOING')
    expect(cheque.status).toBe('ISSUED')
    await transaction((tx) => cancelVoucher(tx, testCtx(), v.id, 'إلغاء الشيك'))
    expect((await db.cheque.findUniqueOrThrow({ where: { id: cheque.id } })).status).toBe('CANCELLED')
  })
})

describe('suppliers', () => {
  it('tracks bills and payments in the supplier balance', async () => {
    const box = await newCashbox('5000')
    const cat = await expenseCategory()
    const date = await yearDate(6)
    const supplier = await transaction((tx) => saveSupplier(tx, testCtx(), { name: uniq('مورد قرطاسية') }))
    const bill = await transaction((tx) =>
      createSupplierBill(tx, testCtx(), { supplierId: supplier.id, date, amount: '1000', expenseAccountId: cat.id, supplierInvoiceNo: 'INV-9' }),
    )
    expect(bill.number).toMatch(/^BILL-\d{4}-\d{6}$/)
    expect((await supplierBalance(db, supplier.id)).toString()).toBe('1000')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('1000')

    await transaction((tx) =>
      createVoucher(tx, testCtx(), { kind: 'SUPPLIER_PAYMENT', date, amount: '400', paymentMethod: 'CASH', cashAccountId: box.id, supplierId: supplier.id }),
    )
    expect((await supplierBalance(db, supplier.id)).toString()).toBe('600')

    // دفعة أكبر من المستحق تحتاج تأكيد «دفعة مقدمة»
    await expect(
      transaction((tx) =>
        createVoucher(tx, testCtx(), { kind: 'SUPPLIER_PAYMENT', date, amount: '700', paymentMethod: 'CASH', cashAccountId: box.id, supplierId: supplier.id }),
      ),
    ).rejects.toThrow(BusinessError)
    await transaction((tx) =>
      createVoucher(tx, testCtx(), {
        kind: 'SUPPLIER_PAYMENT',
        date,
        amount: '700',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
        supplierId: supplier.id,
        allowSupplierAdvance: true,
      }),
    )
    expect((await supplierBalance(db, supplier.id)).toString()).toBe('-100')
    expect(await balanceOf(box.id)).toBe('3900')

    await transaction((tx) => cancelSupplierBill(tx, testCtx(), bill.id, 'فاتورة خاطئة'))
    expect((await supplierBalance(db, supplier.id)).toString()).toBe('-1100')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('0')
  })
})

describe('contractors', () => {
  it('limits payments to the agreed amount and tracks the paid total', async () => {
    const box = await newCashbox('10000')
    const cat = await expenseCategory()
    const date = await yearDate(7)
    const contractor = await transaction((tx) => saveContractor(tx, testCtx(), { name: uniq('عامل دهان'), specialty: 'دهان' }))
    const job = await transaction((tx) =>
      createContractorJob(tx, testCtx(), { contractorId: contractor.id, description: 'دهان الصفوف', agreedAmount: '2000', startDate: date, expenseAccountId: cat.id }),
    )
    const ap = await accountIdByKey(db, 'AP_CONTRACTORS')
    const pay = (amount: string) =>
      transaction((tx) =>
        createVoucher(tx, testCtx(), { kind: 'CONTRACTOR_PAYMENT', date, amount, paymentMethod: 'CASH', cashAccountId: box.id, contractorJobId: job.id }),
      )
    const v1 = await pay('1500')
    expect((await db.contractorJob.findUniqueOrThrow({ where: { id: job.id } })).paidAmount.toString()).toBe('1500')
    await expect(pay('600')).rejects.toThrow(BusinessError)

    await transaction((tx) => adjustContractorJob(tx, testCtx(), job.id, { newAmount: '2500', reason: 'أعمال إضافية', date }))
    await pay('600')
    let j = await db.contractorJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(j.agreedAmount.toString()).toBe('2500')
    expect(j.paidAmount.toString()).toBe('2100')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('2500')

    await transaction((tx) => cancelVoucher(tx, testCtx(), v1.id, 'خطأ'))
    j = await db.contractorJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(j.paidAmount.toString()).toBe('600')

    // إلغاء العمل بعد دفع جزء منه: يُلغى الجزء غير المدفوع فقط
    await transaction((tx) => setJobStatus(tx, testCtx(), job.id, 'CANCELLED', 'توقف العمل'))
    j = await db.contractorJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(j.status).toBe('CANCELLED')
    expect(j.agreedAmount.toString()).toBe('600')
    expect((await accountTotals(db, cat.id)).net.toString()).toBe('600')
    const lines = await db.journalLine.findMany({ where: { accountId: ap, contractorId: contractor.id } })
    const net = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0)
    expect(net).toBe(0)
  })
})

describe('student refunds', () => {
  it('refunds from the student credit and cancellation releases it', async () => {
    const box = await newCashbox('0')
    const student = await makeStudent()
    const date = await yearDate(8)
    await transaction((tx) =>
      createStudentReceipt(tx, testCtx(), {
        kind: 'STUDENT',
        studentId: student.id,
        date,
        amount: '300',
        paymentMethod: 'CASH',
        cashAccountId: box.id,
        confirmCredit: true,
      }),
    )
    expect((await studentCredit(db, student.id)).toString()).toBe('300')
    expect((await arBalance(student.id)).toString()).toBe('-300')

    const refund = (amount: string) =>
      transaction((tx) =>
        createVoucher(tx, testCtx(), { kind: 'STUDENT_REFUND', date, amount, paymentMethod: 'CASH', cashAccountId: box.id, studentId: student.id }),
      )
    await expect(refund('300.5')).rejects.toThrow(BusinessError)
    const v = await refund('120')
    expect((await studentCredit(db, student.id)).toString()).toBe('180')
    expect((await arBalance(student.id)).toString()).toBe('-180')
    expect(await balanceOf(box.id)).toBe('180')

    await transaction((tx) => cancelVoucher(tx, testCtx(), v.id, 'لم يُسلَّم المبلغ'))
    expect((await studentCredit(db, student.id)).toString()).toBe('300')
    expect((await arBalance(student.id)).toString()).toBe('-300')
    expect(await balanceOf(box.id)).toBe('300')
  })

  it('keeps the trial balance at zero', async () => {
    expect(await trialBalanceDiff()).toBe(0)
  })
})
