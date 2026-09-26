import { beforeAll, describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { REPORTS, getReport } from '@/server/reports/registry'
import { parseReportFilters } from '@/server/reports/filters'
import { getSettings } from '@/server/settings'
import { getCurrentYear } from '@/server/years'
import { createCharge } from '@/server/services/charges'
import { createStudentReceipt } from '@/server/services/receipts'
import { ALL_PERMISSIONS } from '@/lib/permissions'
import type { CurrentUser } from '@/server/auth/guard'
import type { ReportEnv } from '@/server/reports/types'
import { D, sum } from '@/lib/money'
import { testCtx } from './support/helpers'
import { chargeType, makeStudent, yearDate } from './support/fixtures'

let env: ReportEnv
let selected: { id: number; startDate: Date; endDate: Date } | null
const admin: CurrentUser = {
  id: 0,
  username: 'test',
  fullName: 'اختبار',
  roleKey: 'admin',
  roleName: 'مدير النظام',
  permissions: new Set(ALL_PERMISSIONS),
  mustChangePassword: false,
  sessionId: 'x',
}

async function run(id: string, params: Record<string, string> = {}) {
  const def = getReport(id)!
  const f = await parseReportFilters(def, params, { today: env.today, weekStartDay: env.settings.finance.weekStartDay, selected })
  return def.run(f, env)
}

beforeAll(async () => {
  const settings = await getSettings()
  const y = await getCurrentYear(db)
  selected = y ? { id: y.id, startDate: y.startDate, endDate: y.endDate } : null
  env = { today: await yearDate(40), settings, user: admin }
})

describe('reports engine', () => {
  it('has the 23 required reports with unique ids', () => {
    expect(REPORTS).toHaveLength(23)
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(23)
  })

  it('runs every report with its default filters', async () => {
    for (const def of REPORTS) {
      const res = await run(def.id)
      expect(Array.isArray(res.rows), def.id).toBe(true)
      expect(res.columns.length, def.id).toBeGreaterThan(0)
      for (const row of res.rows.slice(0, 50)) {
        for (const c of res.columns) expect(c.key in row || row[c.key] === undefined, `${def.id}.${c.key}`).toBe(true)
      }
    }
  })

  it('runs every report with all-years and wide filters', async () => {
    const params = { year: 'all', period: 'all', min: '0', max: '999999999', q: 'ا', status: 'all', kind: 'all' }
    for (const def of REPORTS) {
      await expect(run(def.id, params), def.id).resolves.toBeDefined()
    }
  })
})

describe('report figures', () => {
  it('student balances and collections agree with the recorded documents', async () => {
    const student = await makeStudent()
    const type = await chargeType()
    const y = await getCurrentYear(db)
    const date = await yearDate(5)
    await transaction((tx) =>
      createCharge(tx, testCtx(), { studentId: student.id, chargeTypeId: type.id, academicYearId: y!.id, date, grossAmount: '1200', installments: { count: 3, firstDueDate: date } }),
    )
    const box = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    await transaction((tx) => createStudentReceipt(tx, testCtx(), { kind: 'STUDENT', studentId: student.id, date, amount: '500', paymentMethod: 'CASH', cashAccountId: box.id }))

    const balances = await run('student-balances', { student: String(student.id) })
    expect(balances.rows).toHaveLength(1)
    expect(balances.rows[0].net).toBe('1200')
    expect(balances.rows[0].paid).toBe('500')
    expect(balances.rows[0].remaining).toBe('700')

    const byStudent = await run('by-student', { student: String(student.id) })
    expect(byStudent.totals?.remaining).toBe('700')

    const coll = await run('collections', { student: String(student.id), period: 'all' })
    expect(coll.rows).toHaveLength(1)
    expect(coll.rows[0].amount).toBe('500')

    // الأقساط: 400 × 3، المدفوع 500 → القسط الأول مسدد والثاني جزئي (300 متبقي)
    const dueAll = await run('due-month', { student: String(student.id), from: date, to: '2100-01-01' })
    expect(sum(dueAll.rows.map((r) => String(r.remaining))).toString()).toBe('700')
  })

  it('profit and loss equals revenues minus expenses from the ledger', async () => {
    const pl = await run('profit-loss', { period: 'all' })
    const rev = await run('revenues', { period: 'all' })
    const exp = await run('expenses', { period: 'all' })
    const profit = pl.rows.find((r) => r._style === 'total')!
    const revenue = D(String(rev.totals?.amount))
    const expenses = D(String(exp.totals?.amount))
    expect(D(String(profit.amount)).toString()).toBe(revenue.minus(expenses).toString())
  })

  it('by-grade totals match by-student totals for the year', async () => {
    const g = await run('by-grade')
    const s = await run('by-student')
    expect(D(String(g.totals?.net)).toString()).toBe(D(String(s.totals?.net)).toString())
  })
})
