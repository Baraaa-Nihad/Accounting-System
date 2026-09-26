import { beforeAll, describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { createAcademicYear } from '@/server/services/school'
import { closeYear, closingPreview, reopenYear } from '@/server/services/year-closing'
import { promoteStudents } from '@/server/services/promotion'
import { createStudent } from '@/server/services/students'
import { createCharge, saveFeePlan } from '@/server/services/charges'
import { createStudentReceipt } from '@/server/services/receipts'
import { createVoucher } from '@/server/services/vouchers'
import { savePartner } from '@/server/services/partners'
import { saveCategoryAccount } from '@/server/services/categories'
import { balanceSheet, incomeStatement } from '@/server/services/financial-statements'
import { accountByKey } from '@/server/ledger/accounts'
import { D } from '@/lib/money'
import { toDateOnly } from '@/lib/dates'
import { testCtx } from './support/helpers'
import { chargeType, trialBalanceDiff } from './support/fixtures'

/**
 * إغلاق السنة وترحيل الطلاب على سنتين مستقبليتين خاصتين بالاختبار (لا تتداخلان مع سنوات الاختبارات الأخرى).
 */

const ctx = testCtx()
let Y: { id: number; name: string; start: string; end: string }
let Y2: { id: number; name: string; start: string; end: string }
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`

/** مجموع (مدين − دائن) لحساب داخل فترة. */
async function netIn(accountId: number, from: string, to: string) {
  const [r] = await db.$queryRaw<{ net: string }[]>`SELECT COALESCE(SUM("debit" - "credit"), 0)::text AS net FROM "journal_lines" WHERE "accountId" = ${accountId} AND "date" BETWEEN ${new Date(from)} AND ${new Date(to)}`
  return D(r.net)
}

async function studentIn(yearId: number, gradeName: string, sectionName: string | null, name = `طالب ترحيل ${uid()}`) {
  const grade = await db.grade.findFirstOrThrow({ where: { name: gradeName }, include: { sections: true } })
  return transaction((tx) =>
    createStudent(tx, ctx, {
      fullName: name,
      schoolNumber: null,
      gender: null,
      birthDate: null,
      nationalId: null,
      joinDate: null,
      address: null,
      notes: null,
      guardianId: null,
      guardian: { name: `ولي ${uid()}`, phone: `059${String(Date.now()).slice(-7)}`, phone2: null, relation: null, nationalId: null, email: null, address: null, notes: null },
      academicYearId: yearId,
      gradeId: grade.id,
      sectionId: sectionName ? (grade.sections.find((s) => s.name === sectionName)?.id ?? null) : null,
      confirmDuplicate: true,
    }),
  )
}

beforeAll(async () => {
  // أول سنة حرة بعد 2100 (تبقى سنوات التشغيلات السابقة كما هي)
  const last = await db.academicYear.findFirst({ where: { startDate: { gte: new Date('2100-01-01') } }, orderBy: { startDate: 'desc' } })
  const n = last ? last.endDate.getUTCFullYear() : 2100
  const make = async (y: number) => {
    const yr = await transaction((tx) => createAcademicYear(tx, ctx, { name: `${y}/${y + 1}`, startDate: `${y}-09-01`, endDate: `${y + 1}-08-31` }))
    return { id: yr.id, name: yr.name, start: toDateOnly(yr.startDate), end: toDateOnly(yr.endDate) }
  }
  Y = await make(n)
  Y2 = await make(n + 1)
  // شركاء اختبار الإقفال من تشغيلات سابقة لا يبقون فعالين (حد 100%)
  for (const p of await db.partner.findMany({ where: { isActive: true, name: { startsWith: 'شريك إقفال' } } })) {
    await transaction((tx) => savePartner(tx, ctx, { id: p.id, name: p.name, phone: null, email: null, ownershipPercent: Number(p.ownershipPercent), userId: null, joinDate: null, notes: null, isActive: false }))
  }
})

describe('year closing', () => {
  it('closes revenue and expenses into retained earnings, distributes to partners, and reopens by reversal', async () => {
    const box = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    const type = await chargeType()
    const expense = await transaction((tx) => saveCategoryAccount(tx, ctx, { kind: 'EXPENSE', name: `مصروف إقفال ${uid()}`, isActive: true }))
    const st = await studentIn(Y.id, 'الصف الأول', 'أ')
    const d = `${Y.start.slice(0, 4)}-10-01`
    await transaction((tx) => createCharge(tx, ctx, { studentId: st.id, chargeTypeId: type.id, academicYearId: Y.id, date: d, grossAmount: '1000' }))
    await transaction((tx) => createStudentReceipt(tx, ctx, { kind: 'STUDENT', studentId: st.id, date: d, amount: '1000', paymentMethod: 'CASH', cashAccountId: box.id }))
    await transaction((tx) => createVoucher(tx, ctx, { kind: 'EXPENSE', date: d, amount: '300', paymentMethod: 'CASH', cashAccountId: box.id, expenseAccountId: expense.id, payeeName: 'مورد' }))

    const others = await db.partner.findMany({ where: { isActive: true } })
    const free = 100 - others.reduce((a, p) => a + Number(p.ownershipPercent), 0)
    const pct = Math.min(40, free)
    const partner = await transaction((tx) => savePartner(tx, ctx, { name: `شريك إقفال ${uid()}`, phone: null, email: null, ownershipPercent: pct, userId: null, joinDate: null, notes: null, isActive: true }))

    const preview = await closingPreview(db, Y.id)
    expect(preview.netIncome.toString()).toBe('700')
    expect(preview.partners.find((p) => p.id === partner.id)?.amount.toString()).toBe(D(700).times(pct).dividedBy(100).toString())

    const res = await transaction((tx) => closeYear(tx, ctx, Y.id, { distribute: true, makeNextCurrent: false }))
    expect(res.netIncome.toString()).toBe('700')
    const year = await db.academicYear.findUniqueOrThrow({ where: { id: Y.id } })
    expect(year.status).toBe('CLOSED')
    expect(year.closingEntryId).toBe(res.closingEntry!.id)

    // حسابات النتيجة صفر داخل السنة، والأرباح المحتجزة = الربح − الموزع
    const revenueAcc = await db.chargeType.findUniqueOrThrow({ where: { id: type.id } })
    expect((await netIn(revenueAcc.revenueAccountId, Y.start, Y.end)).toString()).toBe('0')
    expect((await netIn(expense.id, Y.start, Y.end)).toString()).toBe('0')
    const retained = await accountByKey(db, 'RETAINED_EARNINGS')
    const share = D(700).times(pct).dividedBy(100)
    expect((await netIn(retained.id, Y.start, Y.end)).negated().toString()).toBe(D(700).minus(share).toString())
    expect((await netIn(partner.drawingsAccountId!, Y.start, Y.end)).negated().toString()).toBe(share.toString())
    // قائمة الدخل للسنة لا تتأثر بقيد الإقفال، والميزانية متوازنة
    expect((await incomeStatement(db, { from: Y.start, to: Y.end })).netIncome.toString()).toBe('700')
    expect((await balanceSheet(db, { asOf: Y.end })).balanced).toBe(true)
    // لا حركات بتاريخ داخل سنة مغلقة
    await expect(transaction((tx) => createCharge(tx, ctx, { studentId: st.id, chargeTypeId: type.id, academicYearId: Y.id, date: d, grossAmount: '5' }))).rejects.toThrow(/مغلقة/)
    await expect(transaction((tx) => closeYear(tx, ctx, Y.id, { distribute: false, makeNextCurrent: false }))).rejects.toThrow(/مغلقة مسبقًا/)

    // إعادة الفتح تعكس قيدي الإقفال والتوزيع
    const re = await transaction((tx) => reopenYear(tx, ctx, Y.id, 'تصحيح مصروف'))
    expect(re.reversed).toHaveLength(2)
    expect((await db.academicYear.findUniqueOrThrow({ where: { id: Y.id } })).status).toBe('OPEN')
    expect((await netIn(revenueAcc.revenueAccountId, Y.start, Y.end)).toString()).toBe('-1000')
    expect((await netIn(partner.drawingsAccountId!, Y.start, Y.end)).toString()).toBe('0')
    expect(await db.journalEntry.count({ where: { sourceType: 'YEAR_REOPEN', sourceId: Y.id } })).toBe(2)

    // إغلاق من جديد بدون توزيع
    const again = await transaction((tx) => closeYear(tx, ctx, Y.id, { distribute: false, makeNextCurrent: false }))
    expect(again.netIncome.toString()).toBe('700')
    expect((await netIn(retained.id, Y.start, Y.end)).negated().toString()).toBe('700')
    expect(await trialBalanceDiff()).toBe(0)
    await transaction((tx) => savePartner(tx, ctx, { id: partner.id, name: partner.name, phone: null, email: null, ownershipPercent: pct, userId: null, joinDate: null, notes: null, isActive: false }))
  })
})

describe('student promotion', () => {
  it('creates new enrollments, marks outcomes, graduates the last grade, and issues fee plans', async () => {
    const type = await chargeType()
    const grade2 = await db.grade.findFirstOrThrow({ where: { name: 'الصف الثاني' } })
    await transaction((tx) => saveFeePlan(tx, ctx, { academicYearId: Y2.id, gradeId: grade2.id, chargeTypeId: type.id, amount: '4000', installmentsCount: 4 }))
    const a = await studentIn(Y.id, 'الصف الأول', 'أ')
    const b = await studentIn(Y.id, 'الصف الأول', null)
    const c = await studentIn(Y.id, 'الصف الثاني عشر', null)
    const w = await studentIn(Y.id, 'الصف الأول', null)
    await db.student.update({ where: { id: w.id }, data: { status: 'WITHDRAWN' } })

    // السنة المصدر مغلقة (من الاختبار السابق) والهدف مفتوحة
    const res = await transaction((tx) => promoteStudents(tx, ctx, { fromYearId: Y.id, toYearId: Y2.id, mapping: {}, overrides: { [String(b.id)]: 'repeat' }, keepSections: true, applyFees: true }))
    expect(res.graduated).toBeGreaterThanOrEqual(1)
    const enr = async (studentId: number, yearId: number) => db.enrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId: yearId } }, include: { grade: true, section: true } })
    const ea = await enr(a.id, Y2.id)
    expect(ea?.grade.name).toBe('الصف الثاني')
    expect(ea?.section?.name).toBe('أ')
    expect((await enr(a.id, Y.id))?.status).toBe('PROMOTED')
    expect((await enr(b.id, Y2.id))?.grade.name).toBe('الصف الأول')
    expect((await enr(b.id, Y.id))?.status).toBe('REPEATED')
    expect(await enr(c.id, Y2.id)).toBeNull()
    expect((await db.student.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('GRADUATED')
    expect(await enr(w.id, Y2.id)).toBeNull()
    // الرسوم المقررة للصف الثاني في السنة الجديدة، مؤرخة ببدايتها
    const fee = await db.charge.findFirstOrThrow({ where: { studentId: a.id, academicYearId: Y2.id }, include: { installments: true } })
    expect(D(fee.grossAmount).toString()).toBe('4000')
    expect(toDateOnly(fee.date)).toBe(Y2.start)
    expect(fee.installments).toHaveLength(4)
    expect(await db.charge.count({ where: { studentId: b.id, academicYearId: Y2.id } })).toBe(0)

    // إعادة التنفيذ لا تكرر التسجيل
    const again = await transaction((tx) => promoteStudents(tx, ctx, { fromYearId: Y.id, toYearId: Y2.id, mapping: {}, overrides: {}, keepSections: true, applyFees: true }))
    expect(again.promoted).toBe(0)
    expect(again.already).toBeGreaterThanOrEqual(2)
    expect(await db.enrollment.count({ where: { studentId: a.id } })).toBe(2)
    await expect(transaction((tx) => promoteStudents(tx, ctx, { fromYearId: Y2.id, toYearId: Y.id, mapping: {}, overrides: {}, keepSections: false, applyFees: false }))).rejects.toThrow()
  })
})
