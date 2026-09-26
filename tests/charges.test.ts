import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import {
  addDiscount,
  cancelCharge,
  cancelDiscount,
  createBulkCharges,
  createCharge,
  previewBulkCharges,
  rescheduleCharge,
  saveFeePlan,
  cancelFutureInstallmentsForWithdrawal,
} from '@/server/services/charges'
import { testCtx } from './support/helpers'
import { arBalance, chargeType, currentYear, makeStudent, trialBalanceDiff, yearDate } from './support/fixtures'

async function installments(chargeId: number) {
  return db.installment.findMany({ where: { chargeId, status: { not: 'CANCELLED' } }, orderBy: { number: 'asc' } })
}

describe('charges and installments', () => {
  it('creates a charge with a discount and an 8-installment schedule (4800 / 8 = 600)', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), {
        studentId: student.id,
        chargeTypeId: type.id,
        academicYearId: year.id,
        date,
        grossAmount: '5000',
        discount: { method: 'FIXED', value: '200', reason: 'خصم خاص', approvedBy: 'الإدارة' },
        installments: { count: 8, firstDueDate: date, dueDay: 5 },
      }),
    )
    expect(charge.grossAmount.toString()).toBe('5000')
    expect(charge.discountAmount.toString()).toBe('200')
    expect(charge.netAmount.toString()).toBe('4800')
    const inst = await installments(charge.id)
    expect(inst).toHaveLength(8)
    expect(inst.every((i) => i.amount.toString() === '600')).toBe(true)
    expect((await arBalance(student.id)).toString()).toBe('4800')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('computes a 10% discount: 5000 → 500 → 4500', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), {
        studentId: student.id,
        chargeTypeId: type.id,
        academicYearId: year.id,
        date,
        grossAmount: '5000',
        discount: { method: 'PERCENT', value: '10', reason: 'خصم إخوة' },
      }),
    )
    expect(charge.discountAmount.toString()).toBe('500')
    expect(charge.netAmount.toString()).toBe('4500')
    const d = await db.discount.findFirstOrThrow({ where: { chargeId: charge.id } })
    expect(d.baseAmount.toString()).toBe('5000')
    expect(d.amount.toString()).toBe('500')
    expect(d.netAmount.toString()).toBe('4500')
  })

  it('redistributes unpaid installments when a later discount is added and cancelled', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
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
    const discount = await transaction((tx) =>
      addDiscount(tx, testCtx(), {
        studentId: student.id,
        scope: 'CHARGE',
        chargeId: charge.id,
        academicYearId: year.id,
        method: 'PERCENT',
        value: '10',
        reason: 'تفوق',
        date,
        distribution: 'EVEN',
      }),
    )
    let inst = await installments(charge.id)
    expect(inst.map((i) => i.amount.toString())).toEqual(Array(8).fill('540'))
    expect((await arBalance(student.id)).toString()).toBe('4320')

    await transaction((tx) => cancelDiscount(tx, testCtx(), discount.id, 'خطأ في الإدخال'))
    inst = await installments(charge.id)
    expect(inst.map((i) => i.amount.toString())).toEqual(Array(8).fill('600'))
    expect((await arBalance(student.id)).toString()).toBe('4800')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('applies FROM_LAST discounts to the last installments', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), {
        studentId: student.id,
        chargeTypeId: type.id,
        academicYearId: year.id,
        date,
        grossAmount: '1000',
        installments: { count: 4, firstDueDate: date },
      }),
    )
    await transaction((tx) =>
      addDiscount(tx, testCtx(), {
        studentId: student.id,
        scope: 'CHARGE',
        chargeId: charge.id,
        academicYearId: year.id,
        method: 'FIXED',
        value: '300',
        reason: 'خصم من الإدارة',
        date,
        distribution: 'FROM_LAST',
      }),
    )
    const inst = await installments(charge.id)
    expect(inst.map((i) => i.amount.toString())).toEqual(['250', '250', '200', '0'])
    expect(inst[3].status).toBe('PAID')
  })

  it('rejects a discount larger than the charge', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: type.id, academicYearId: year.id, date, grossAmount: '100' }),
    )
    await expect(
      transaction((tx) =>
        addDiscount(tx, testCtx(), {
          studentId: student.id,
          scope: 'CHARGE',
          chargeId: charge.id,
          academicYearId: year.id,
          method: 'FIXED',
          value: '150',
          reason: 'x',
          date,
          distribution: 'EVEN',
        }),
      ),
    ).rejects.toThrow(/أكبر من المتبقي/)
  })

  it('reschedules and cancels a charge, reversing everything', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(5)
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
    await transaction((tx) => rescheduleCharge(tx, testCtx(), charge.id, { count: 4, firstDueDate: date }))
    const inst = await installments(charge.id)
    expect(inst.map((i) => i.amount.toString())).toEqual(Array(4).fill('1200'))
    expect((await arBalance(student.id)).toString()).toBe('4800')

    await transaction((tx) => cancelCharge(tx, testCtx(), charge.id, 'تسجيل بالخطأ'))
    const after = await db.charge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(after.status).toBe('CANCELLED')
    expect((await arBalance(student.id)).toString()).toBe('0')
    expect(await db.installment.count({ where: { chargeId: charge.id, status: { not: 'CANCELLED' } } })).toBe(0)
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('cancels future installments on withdrawal with a revenue reversal', async () => {
    const student = await makeStudent()
    const year = await currentYear()
    const type = await chargeType()
    const date = await yearDate(1)
    const charge = await transaction((tx) =>
      createCharge(tx, testCtx(), {
        studentId: student.id,
        chargeTypeId: type.id,
        academicYearId: year.id,
        date,
        grossAmount: '1000',
        installments: { count: 4, firstDueDate: date },
      }),
    )
    const inst = await installments(charge.id)
    const withdrawal = inst[1].dueDate.toISOString().slice(0, 10)
    const result = await transaction((tx) => cancelFutureInstallmentsForWithdrawal(tx, testCtx(), student.id, withdrawal, 'انتقل لمدرسة أخرى'))
    expect(result.total).toBe('500')
    const after = await db.charge.findUniqueOrThrow({ where: { id: charge.id } })
    expect(after.grossAmount.toString()).toBe('500')
    expect(after.netAmount.toString()).toBe('500')
    expect((await arBalance(student.id)).toString()).toBe('500')
  })

  it('issues bulk charges from fee plans once and skips duplicates', async () => {
    const year = await currentYear()
    const type = await chargeType('رسوم التسجيل')
    const grade = await db.grade.findFirstOrThrow({ where: { name: 'الصف الثالث' } })
    const s1 = await makeStudent({ gradeName: 'الصف الثالث' })
    const s2 = await makeStudent({ gradeName: 'الصف الثالث' })
    const date = await yearDate(3)
    await transaction((tx) =>
      saveFeePlan(tx, testCtx(), {
        academicYearId: year.id,
        gradeId: grade.id,
        chargeTypeId: type.id,
        amount: '300',
        installmentsCount: 1,
        firstDueDate: date,
      }),
    )
    const input = {
      academicYearId: year.id,
      chargeTypeId: type.id,
      gradeIds: [grade.id],
      studentIds: [s1.id, s2.id],
      useFeePlan: true,
      date,
      applyRules: true,
    }
    const preview = await previewBulkCharges(db, input)
    expect(preview.filter((p) => !p.skip)).toHaveLength(2)
    const res = await transaction((tx) => createBulkCharges(tx, testCtx(), input))
    expect(res.created).toBe(2)
    const again = await transaction((tx) => createBulkCharges(tx, testCtx(), input))
    expect(again.created).toBe(0)
    expect(again.skipped).toBe(2)
    expect((await arBalance(s1.id)).toString()).toBe('300')
  })
})
