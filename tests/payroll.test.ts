import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { BusinessError } from '@/server/errors'
import { calcPayrollItem } from '@/lib/payroll-calc'
import { createEmployee, setEmployeeStatus, updateEmployee } from '@/server/services/employees'
import {
  approveRun,
  cancelOvertime,
  cancelRun,
  createOvertime,
  createPayrollRun,
  recalculateRun,
  updatePayrollItem,
} from '@/server/services/payroll'
import { createAdvance } from '@/server/services/advances'
import { paySalaries } from '@/server/services/payroll-pay'
import { cancelVoucher, createVoucher } from '@/server/services/vouchers'
import { createCashAccount } from '@/server/services/treasury'
import { accountIdByKey } from '@/server/ledger/accounts'
import { partyBalance } from '@/server/ledger/balances'
import { addMonths, makeDate, parts } from '@/lib/dates'
import { testCtx } from './support/helpers'
import { currentYear, trialBalanceDiff, yearDate } from './support/fixtures'

const created: number[] = []
const PREFIX = 'موظف اختبار رواتب'

async function employee(salary = '3000', extra?: { overtimeRate?: string; salaryType?: 'MONTHLY' | 'DAILY' | 'HOURLY'; hireDate?: string }) {
  const e = await transaction((tx) =>
    createEmployee(tx, testCtx(), {
      fullName: `${PREFIX} ${Date.now()}${Math.floor(Math.random() * 1000)}`,
      salaryType: extra?.salaryType ?? 'MONTHLY',
      baseSalary: salary,
      overtimeRate: extra?.overtimeRate ?? null,
      hireDate: extra?.hireDate ?? null,
    }),
  )
  created.push(e.id)
  return e
}

/** شهر داخل السنة الدراسية الحالية (بعد بدايتها بعدد أشهر). */
async function month(offset: number) {
  const y = await currentYear()
  const start = new Date(y.startDate)
  const d = addMonths(makeDate(start.getUTCFullYear(), start.getUTCMonth() + 1, 1), offset)
  const { y: year, m } = parts(d)
  return { year, month: m, first: makeDate(year, m, 1), mid: makeDate(year, m, 15) }
}

/** تحرير الشهر من مسيرات اختبارات سابقة (بالإلغاء، دون حذف). */
async function freeMonth(year: number, m: number) {
  const runs = await db.payrollRun.findMany({ where: { year, month: m, status: { not: 'CANCELLED' } }, include: { items: true } })
  for (const run of runs) {
    const vouchers = await db.paymentVoucher.findMany({ where: { payrollItemId: { in: run.items.map((i) => i.id) }, status: 'ACTIVE' } })
    for (const v of vouchers) await transaction((tx) => cancelVoucher(tx, testCtx(), v.id, 'تنظيف اختبار'))
    await transaction((tx) => cancelRun(tx, testCtx(), run.id, 'تنظيف اختبار'))
  }
}

async function cashbox(opening = '100000') {
  const date = await yearDate(0)
  return transaction((tx) => createCashAccount(tx, testCtx(), { name: `صندوق رواتب ${Date.now()}${Math.random()}`, type: 'CASHBOX', openingBalance: opening, openingDate: date }))
}

async function itemOf(runId: number, employeeId: number) {
  return db.payrollItem.findUniqueOrThrow({ where: { payrollRunId_employeeId: { payrollRunId: runId, employeeId } } })
}

beforeAll(async () => {
  // موظفو اختبارات سابقة لا يدخلون المسيرات الجديدة
  const old = await db.employee.findMany({ where: { status: 'ACTIVE', fullName: { startsWith: PREFIX } } })
  for (const e of old) await transaction((tx) => setEmployeeStatus(tx, testCtx(), e.id, { status: 'INACTIVE' }))
})

afterAll(async () => {
  for (const id of created) {
    const e = await db.employee.findUnique({ where: { id } })
    if (e?.status === 'ACTIVE') await transaction((tx) => setEmployeeStatus(tx, testCtx(), id, { status: 'INACTIVE' }))
  }
})

describe('payroll calculation', () => {
  it('matches the documented example: 3000 + (10 × 20) + 100 − 50 = 3250', () => {
    const r = calcPayrollItem(
      {
        salaryType: 'MONTHLY',
        rate: '3000',
        workDays: '30',
        workHours: '0',
        absenceDays: '0',
        lateHours: '0',
        overtimeAmount: '200',
        bonuses: '100',
        allowances: '0',
        otherDeductions: '50',
        withholdings: '0',
        plannedAdvance: '0',
      },
      { workDaysPerMonth: 30, hoursPerDay: 8, decimals: 2 },
    )
    expect(r.grossPay).toBe('3300')
    expect(r.netPay).toBe('3250')
    expect(r.error).toBeNull()
  })

  it('computes absence, lateness, proration, and caps the advance installment', () => {
    const cfg = { workDaysPerMonth: 30, hoursPerDay: 8, decimals: 2 }
    const base = { salaryType: 'MONTHLY' as const, rate: '3000', workHours: '0', overtimeAmount: '0', bonuses: '0', allowances: '0', otherDeductions: '0', withholdings: '0' }
    const a = calcPayrollItem({ ...base, workDays: '30', absenceDays: '2', lateHours: '4', plannedAdvance: '0' }, cfg)
    expect(a.absenceDeduction).toBe('200') // 3000 / 30 × 2
    expect(a.lateDeduction).toBe('50') // 3000 / 240 × 4
    expect(a.netPay).toBe('2750')
    const half = calcPayrollItem({ ...base, workDays: '15', absenceDays: '0', lateHours: '0', plannedAdvance: '0' }, cfg)
    expect(half.basicPay).toBe('1500')
    const capped = calcPayrollItem({ ...base, rate: '500', workDays: '30', absenceDays: '0', lateHours: '0', plannedAdvance: '800' }, cfg)
    expect(capped.advanceDeduction).toBe('500')
    expect(capped.netPay).toBe('0')
    const daily = calcPayrollItem({ ...base, salaryType: 'DAILY', rate: '100', workDays: '22', absenceDays: '0', lateHours: '0', plannedAdvance: '0' }, cfg)
    expect(daily.basicPay).toBe('2200')
    const hourly = calcPayrollItem({ ...base, salaryType: 'HOURLY', rate: '25', workDays: '0', workHours: '80', absenceDays: '0', lateHours: '0', plannedAdvance: '0' }, cfg)
    expect(hourly.basicPay).toBe('2000')
  })
})

describe('payroll cycle', () => {
  it('draft → approve (journal) → pay; overtime and advances flow through', async () => {
    const mo = await month(1)
    await freeMonth(mo.year, mo.month)
    const box = await cashbox()
    const emp = await employee('3000', { overtimeRate: '20' })
    await transaction((tx) => createOvertime(tx, testCtx(), { employeeId: emp.id, date: mo.mid, hours: '10' }))
    const { voucher: advVoucher, advance } = await transaction((tx) =>
      createAdvance(tx, testCtx(), {
        employeeId: emp.id,
        date: mo.first,
        amount: '600',
        installmentsCount: 3,
        cashAccountId: box.id,
        paymentMethod: 'CASH',
        startYear: mo.year,
        startMonth: mo.month,
      }),
    )
    expect(advVoucher.kind).toBe('ADVANCE')
    expect(advance.monthlyDeduction.toString()).toBe('200')

    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    expect(run.status).toBe('DRAFT')
    await expect(transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))).rejects.toThrow(BusinessError)

    let item = await itemOf(run.id, emp.id)
    expect(item.overtimeAmount.toString()).toBe('200')
    expect(item.grossPay.toString()).toBe('3200')
    expect(item.advanceDeduction.toString()).toBe('200')
    expect(item.netPay.toString()).toBe('3000')

    // مكافأة وخصم من الجدول
    item = await transaction((tx) =>
      updatePayrollItem(tx, testCtx(), item.id, {
        workDays: '30',
        workHours: '0',
        absenceDays: '0',
        lateHours: '0',
        bonuses: '100',
        allowances: '0',
        otherDeductions: '50',
        withholdings: '0',
      }),
    )
    expect(item.netPay.toString()).toBe('3050') // 3000 + 200 + 100 − 50 − 200

    await transaction((tx) => approveRun(tx, testCtx(), run.id))
    const approved = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(approved.status).toBe('APPROVED')
    const lines = await db.journalLine.findMany({ where: { entryId: approved.journalEntryId!, employeeId: emp.id } })
    const [expense, payable, advancesAcc] = await Promise.all([
      accountIdByKey(db, 'SALARIES_EXPENSE'),
      accountIdByKey(db, 'SALARIES_PAYABLE'),
      accountIdByKey(db, 'EMPLOYEE_ADVANCES'),
    ])
    expect(lines.find((l) => l.accountId === expense)?.debit.toString()).toBe('3250')
    expect(lines.find((l) => l.accountId === payable)?.credit.toString()).toBe('3050')
    expect(lines.find((l) => l.accountId === advancesAcc)?.credit.toString()).toBe('200')
    expect((await db.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } })).deductedAmount.toString()).toBe('200')
    expect((await db.overtimeEntry.findFirstOrThrow({ where: { employeeId: emp.id } })).status).toBe('INCLUDED')

    // المبالغ المعتمدة ثابتة على مستوى قاعدة البيانات
    await expect(db.$executeRaw`UPDATE "payroll_items" SET "netPay" = 1 WHERE "id" = ${item.id}`).rejects.toThrow(/IMMUTABLE_RECORD/)

    // صرف جزئي ثم صرف الباقي للجميع
    await transaction((tx) =>
      createVoucher(tx, testCtx(), { kind: 'SALARY', date: mo.mid, amount: '1000', paymentMethod: 'CASH', cashAccountId: box.id, payrollItemId: item.id }),
    )
    expect((await itemOf(run.id, emp.id)).paymentStatus).toBe('PARTIAL')
    await expect(transaction((tx) => cancelRun(tx, testCtx(), run.id, 'محاولة إلغاء'))).rejects.toThrow(BusinessError)
    await transaction((tx) => paySalaries(tx, testCtx(), { runId: run.id, itemIds: [item.id], date: mo.mid, cashAccountId: box.id, paymentMethod: 'CASH' }))
    const paidItem = await itemOf(run.id, emp.id)
    expect(paidItem.paidAmount.toString()).toBe('3050')
    expect(paidItem.paymentStatus).toBe('PAID')

    // كشف الموظف: الرواتب المستحقة صفر، والسلفة المتبقية 400 عليه
    expect((await partyBalance(db, payable, { employeeId: emp.id })).net.toString()).toBe('0')
    expect((await partyBalance(db, advancesAcc, { employeeId: emp.id })).net.toString()).toBe('400')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('cancelling an approved run restores advances and overtime', async () => {
    const mo = await month(2)
    await freeMonth(mo.year, mo.month)
    const box = await cashbox()
    const emp = await employee('2000', { overtimeRate: '15' })
    await transaction((tx) => createOvertime(tx, testCtx(), { employeeId: emp.id, date: mo.mid, hours: '4' }))
    const { advance } = await transaction((tx) =>
      createAdvance(tx, testCtx(), { employeeId: emp.id, date: mo.first, amount: '300', installmentsCount: 1, cashAccountId: box.id, paymentMethod: 'CASH', startYear: mo.year, startMonth: mo.month }),
    )
    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    await transaction((tx) => approveRun(tx, testCtx(), run.id))
    expect((await db.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } })).status).toBe('SETTLED')
    // لا يُسجل إضافي على شهر معتمد
    await expect(transaction((tx) => createOvertime(tx, testCtx(), { employeeId: emp.id, date: mo.mid, hours: '1' }))).rejects.toThrow(BusinessError)

    await transaction((tx) => cancelRun(tx, testCtx(), run.id, 'خطأ في الاحتساب'))
    const cancelled = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.reversalEntryId).not.toBeNull()
    const adv = await db.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } })
    expect(adv.status).toBe('ACTIVE')
    expect(adv.deductedAmount.toString()).toBe('0')
    expect((await db.overtimeEntry.findFirstOrThrow({ where: { employeeId: emp.id } })).status).toBe('PENDING')

    // يمكن إعادة احتساب نفس الشهر بعد الإلغاء
    const again = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    expect((await itemOf(again.id, emp.id)).overtimeAmount.toString()).toBe('60')
    await transaction((tx) => cancelRun(tx, testCtx(), again.id, 'تنظيف'))
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('caps the advance installment at the available salary and carries the rest', async () => {
    const mo = await month(3)
    await freeMonth(mo.year, mo.month)
    const box = await cashbox()
    const emp = await employee('500')
    const { advance } = await transaction((tx) =>
      createAdvance(tx, testCtx(), { employeeId: emp.id, date: mo.first, amount: '800', installmentsCount: 1, cashAccountId: box.id, paymentMethod: 'CASH', startYear: mo.year, startMonth: mo.month }),
    )
    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    const item = await itemOf(run.id, emp.id)
    expect(item.advanceDeduction.toString()).toBe('500')
    expect(item.netPay.toString()).toBe('0')
    await transaction((tx) => approveRun(tx, testCtx(), run.id))
    const adv = await db.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } })
    expect(adv.deductedAmount.toString()).toBe('500')
    expect(adv.status).toBe('ACTIVE')
  })

  it('prorates a mid-month hire and refreshes salaries on recalculation', async () => {
    const mo = await month(4)
    await freeMonth(mo.year, mo.month)
    const hired = await employee('3000', { hireDate: makeDate(mo.year, mo.month, 16) })
    const regular = await employee('2400')
    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    const h = await itemOf(run.id, hired.id)
    expect(h.workDays.toString()).toBe('15')
    expect(h.basicPay.toString()).toBe('1500')
    await transaction((tx) => updateEmployee(tx, testCtx(), regular.id, { fullName: regular.fullName, salaryType: 'MONTHLY', baseSalary: '2700' }))
    expect((await itemOf(run.id, regular.id)).netPay.toString()).toBe('2400')
    await transaction((tx) => recalculateRun(tx, testCtx(), run.id))
    expect((await itemOf(run.id, regular.id)).netPay.toString()).toBe('2700')
    // إضافي جديد بعد الاحتساب يمنع الاعتماد حتى إعادة الاحتساب
    const ot = await transaction((tx) => createOvertime(tx, testCtx(), { employeeId: regular.id, date: mo.mid, hours: '2', rate: '10' }))
    await expect(transaction((tx) => approveRun(tx, testCtx(), run.id))).rejects.toThrow(/إعادة الاحتساب/)
    await transaction((tx) => cancelOvertime(tx, testCtx(), ot.id, 'مكرر'))
    await transaction((tx) => cancelRun(tx, testCtx(), run.id, 'تنظيف'))
  })

  it('cancelling a paid advance voucher is blocked once deducted in an approved run', async () => {
    const mo = await month(5)
    await freeMonth(mo.year, mo.month)
    const box = await cashbox()
    const emp = await employee('1000')
    const { voucher } = await transaction((tx) =>
      createAdvance(tx, testCtx(), { employeeId: emp.id, date: mo.first, amount: '400', installmentsCount: 2, cashAccountId: box.id, paymentMethod: 'CASH', startYear: mo.year, startMonth: mo.month }),
    )
    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month }))
    await transaction((tx) => approveRun(tx, testCtx(), run.id))
    await expect(transaction((tx) => cancelVoucher(tx, testCtx(), voucher.id, 'خطأ'))).rejects.toThrow(BusinessError)
    await transaction((tx) => cancelRun(tx, testCtx(), run.id, 'تنظيف'))
    // بعد إلغاء المسير يمكن إلغاء سند السلفة
    await transaction((tx) => cancelVoucher(tx, testCtx(), voucher.id, 'خطأ'))
    expect((await db.employeeAdvance.findFirstOrThrow({ where: { employeeId: emp.id } })).status).toBe('CANCELLED')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('does not allow paying a salary before the payroll posting date', async () => {
    const mo = await month(6)
    await freeMonth(mo.year, mo.month)
    const box = await cashbox()
    const emp = await employee('1500')
    const end = makeDate(mo.year, mo.month, 28)
    const run = await transaction((tx) => createPayrollRun(tx, testCtx(), { year: mo.year, month: mo.month, postingDate: end }))
    await transaction((tx) => approveRun(tx, testCtx(), run.id))
    const item = await itemOf(run.id, emp.id)
    await expect(
      transaction((tx) => createVoucher(tx, testCtx(), { kind: 'SALARY', date: mo.mid, amount: '100', paymentMethod: 'CASH', cashAccountId: box.id, payrollItemId: item.id })),
    ).rejects.toThrow(/قبل تاريخ قيد/)
    await transaction((tx) => paySalaries(tx, testCtx(), { runId: run.id, itemIds: [item.id], date: end, cashAccountId: box.id, paymentMethod: 'CASH' }))
    expect((await itemOf(run.id, emp.id)).paymentStatus).toBe('PAID')
  })
})
