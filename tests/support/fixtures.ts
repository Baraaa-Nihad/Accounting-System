import { db, transaction } from '@/server/db'
import { createStudent } from '@/server/services/students'
import { getCurrentYear } from '@/server/years'
import { toDateOnly } from '@/lib/dates'
import { accountIdByKey } from '@/server/ledger/accounts'
import { partyBalance } from '@/server/ledger/balances'
import { testCtx } from './helpers'

let counter = 0

export async function currentYear() {
  const y = await getCurrentYear(db)
  if (!y) throw new Error('no year')
  return y
}

/** تاريخ داخل السنة الحالية (بعد بدايتها بعدد أيام). */
export async function yearDate(offsetDays = 10) {
  const y = await currentYear()
  const d = new Date(y.startDate)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return toDateOnly(d)
}

export async function makeStudent(overrides?: { name?: string; phone?: string; gradeName?: string }) {
  counter++
  const year = await currentYear()
  const grade = await db.grade.findFirstOrThrow({ where: overrides?.gradeName ? { name: overrides.gradeName } : { name: 'الصف الأول' } })
  const unique = `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`
  return transaction((tx) =>
    createStudent(tx, testCtx(), {
      fullName: overrides?.name ?? `طالب اختبار ${unique}`,
      schoolNumber: null,
      gender: null,
      birthDate: null,
      nationalId: null,
      joinDate: null,
      address: null,
      notes: null,
      guardianId: null,
      guardian: {
        name: `ولي أمر ${unique}`,
        phone: overrides?.phone ?? `059${unique.slice(-7)}`,
        phone2: null,
        relation: null,
        nationalId: null,
        email: null,
        address: null,
        notes: null,
      },
      academicYearId: year.id,
      gradeId: grade.id,
      sectionId: null,
      confirmDuplicate: true,
    }),
  )
}

export async function chargeType(name = 'القسط الدراسي') {
  return db.chargeType.findFirstOrThrow({ where: { name } })
}

/** رصيد الطالب في الأستاذ العام (حساب ذمم الطلاب). */
export async function arBalance(studentId: number) {
  const ar = await accountIdByKey(db, 'AR_STUDENTS')
  return (await partyBalance(db, ar, { studentId })).net
}

/** ميزان المراجعة الكلي: مجموع المدين = مجموع الدائن. */
export async function trialBalanceDiff() {
  const [row] = await db.$queryRaw<{ debit: string; credit: string }[]>`
    SELECT COALESCE(SUM("debit"),0)::text AS debit, COALESCE(SUM("credit"),0)::text AS credit FROM "journal_lines"`
  return Number(row.debit) - Number(row.credit)
}
