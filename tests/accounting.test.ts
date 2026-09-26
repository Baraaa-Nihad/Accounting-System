import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { accountTree, createAccount, createManualEntry, reverseManualEntry, updateAccount } from '@/server/services/accounting'
import { balanceSheet, incomeStatement, trialBalance } from '@/server/services/financial-statements'
import { accountByKey } from '@/server/ledger/accounts'
import { accountTotals } from '@/server/ledger/balances'
import { getReport } from '@/server/reports/registry'
import { parseReportFilters } from '@/server/reports/filters'
import { getSettings } from '@/server/settings'
import { createCharge } from '@/server/services/charges'
import { ALL_PERMISSIONS } from '@/lib/permissions'
import type { CurrentUser } from '@/server/auth/guard'
import { D, sum } from '@/lib/money'
import { testCtx } from './support/helpers'
import { chargeType, currentYear, makeStudent, yearDate } from './support/fixtures'

const ctx = testCtx()
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`

describe('chart of accounts', () => {
  it('creates accounts under groups with automatic or manual codes, and guards deactivation', async () => {
    const fixed = await accountByKey(db, 'FIXED_ASSETS')
    const group = await transaction((tx) => createAccount(tx, ctx, { parentId: fixed.id, name: `مجموعة ${uid()}`, code: null, description: null, isGroup: true }))
    expect(group.code.startsWith(fixed.code)).toBe(true)
    expect(group.isGroup).toBe(true)
    const leaf = await transaction((tx) => createAccount(tx, ctx, { parentId: group.id, name: 'أجهزة حاسوب', code: null, description: null, isGroup: false }))
    expect(leaf.code.startsWith(group.code)).toBe(true)
    expect(leaf.type).toBe('ASSET')
    await expect(transaction((tx) => createAccount(tx, ctx, { parentId: group.id, name: 'آخر', code: '9999', description: null, isGroup: false }))).rejects.toThrow(/يبدأ برمز/)
    await expect(transaction((tx) => createAccount(tx, ctx, { parentId: leaf.id, name: 'تحت ورقة', code: null, description: null, isGroup: false }))).rejects.toThrow(/غير تجميعي/)
    await expect(transaction((tx) => createAccount(tx, ctx, { parentId: group.id, name: 'أجهزة حاسوب', code: null, description: null, isGroup: false }))).rejects.toThrow(/بنفس الاسم/)

    // حساب نظامي لا يُعطّل
    const ar = await accountByKey(db, 'AR_STUDENTS')
    await expect(transaction((tx) => updateAccount(tx, ctx, ar.id, { name: ar.name, description: null, isActive: false }))).rejects.toThrow(/لا تُعطّل/)
    // حساب برصيد لا يُعطّل، وبعد تصفيره يُعطّل
    const expense = (await db.account.findMany({ where: { type: 'EXPENSE', isGroup: false, systemKey: null, isActive: true }, orderBy: { code: 'asc' }, take: 1 }))[0]
    const date = await yearDate(4)
    await transaction((tx) => createManualEntry(tx, ctx, { date, description: 'شراء أجهزة (تسوية)', lines: [{ accountId: leaf.id, debit: '900', credit: null, description: null }, { accountId: expense.id, debit: null, credit: '900', description: null }] }))
    await expect(transaction((tx) => updateAccount(tx, ctx, leaf.id, { name: leaf.name, description: null, isActive: false }))).rejects.toThrow(/رصيده غير صفري/)
    const tree = await accountTree(db)
    const g = tree.find((a) => a.id === group.id)!
    expect(g.balance.toString()).toBe('900')
    const root = tree.find((a) => a.systemKey === 'ASSETS')!
    const leaves = tree.filter((a) => !a.isGroup && a.type === 'ASSET')
    expect(root.balance.toString()).toBe(sum(leaves.map((a) => a.balance)).toString())
  })
})

describe('manual journal entries', () => {
  it('allows only free accounts, requires balance, and reverses without deleting', async () => {
    const date = await yearDate(6)
    const [expenses, other, box, ar] = await Promise.all([
      db.account.findMany({ where: { type: 'EXPENSE', isGroup: false, systemKey: null, isActive: true }, orderBy: { code: 'asc' }, take: 2 }),
      accountByKey(db, 'OTHER_PAYABLES'),
      db.cashAccount.findFirstOrThrow({ where: { isDefault: true } }),
      accountByKey(db, 'AR_STUDENTS'),
    ])
    const [e1, e2] = expenses
    await expect(transaction((tx) => createManualEntry(tx, ctx, { date, description: 'نقدي', lines: [{ accountId: e1.id, debit: '10', credit: null, description: null }, { accountId: box.glAccountId, debit: null, credit: '10', description: null }] }))).rejects.toThrow(/لا يُستخدم في القيود اليدوية/)
    await expect(transaction((tx) => createManualEntry(tx, ctx, { date, description: 'طالب', lines: [{ accountId: ar.id, debit: '10', credit: null, description: null }, { accountId: e1.id, debit: null, credit: '10', description: null }] }))).rejects.toThrow(/لا يُستخدم في القيود اليدوية/)
    await expect(transaction((tx) => createManualEntry(tx, ctx, { date, description: 'غير متوازن', lines: [{ accountId: e1.id, debit: '10', credit: null, description: null }, { accountId: other.id, debit: null, credit: '9', description: null }] }))).rejects.toThrow(/غير متوازن/)

    const before1 = (await accountTotals(db, e1.id)).net
    const entry = await transaction((tx) =>
      createManualEntry(tx, ctx, {
        date,
        description: 'إعادة تصنيف ومصروف مستحق',
        lines: [
          { accountId: e1.id, debit: '300', credit: null, description: null },
          { accountId: e2.id, debit: null, credit: '100', description: null },
          { accountId: other.id, debit: null, credit: '200', description: 'مستحق للمورد لاحقًا' },
        ],
      }),
    )
    expect(entry.sourceType).toBe('MANUAL')
    expect((await accountTotals(db, e1.id)).net.minus(before1).toString()).toBe('300')
    expect(await db.auditLog.count({ where: { entityType: 'JournalEntry', entityId: String(entry.id), action: 'create' } })).toBe(1)

    const rev = await transaction((tx) => reverseManualEntry(tx, ctx, entry.id, { date, reason: 'قيد بالخطأ' }))
    expect(rev.reversalOfId).toBe(entry.id)
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('REVERSED')
    expect((await accountTotals(db, e1.id)).net.toString()).toBe(before1.toString())
    await expect(transaction((tx) => reverseManualEntry(tx, ctx, entry.id, { date, reason: 'مرة ثانية' }))).rejects.toThrow(/معكوس مسبقًا/)
    await expect(transaction((tx) => reverseManualEntry(tx, ctx, rev.id, { date, reason: 'عكس العكس' }))).rejects.toThrow(/قيد عكسي/)

    // القيود الآلية تُلغى من مستنداتها فقط
    const st = await makeStudent()
    const y = await currentYear()
    const charge = await transaction(async (tx) => createCharge(tx, ctx, { studentId: st.id, chargeTypeId: (await chargeType()).id, academicYearId: y.id, date, grossAmount: '100' }))
    await expect(transaction((tx) => reverseManualEntry(tx, ctx, charge.journalEntryId!, { date, reason: 'محاولة' }))).rejects.toThrow(/قيد آلي/)
  })
})

describe('financial statements', () => {
  const admin: CurrentUser = { id: 0, username: 't', fullName: 't', roleKey: 'admin', roleName: 'admin', permissions: new Set(ALL_PERMISSIONS), mustChangePassword: false, sessionId: 'x' }

  it('trial balance balances and closing = opening + movement', async () => {
    const y = await currentYear()
    const from = (await yearDate(0))
    const to = (await yearDate(300))
    const tb = await trialBalance(db, { from, to })
    expect(tb.balanced).toBe(true)
    expect(tb.totals.closingDebit.toString()).toBe(tb.totals.closingCredit.toString())
    for (const r of tb.rows) {
      const opening = r.openingDebit.minus(r.openingCredit)
      const closing = r.closingDebit.minus(r.closingCredit)
      expect(closing.toString(), r.code).toBe(opening.plus(r.periodDebit).minus(r.periodCredit).toString())
    }
    expect(y).toBeTruthy()
  })

  it('income statement matches the profit and loss report, and the balance sheet balances', async () => {
    const settings = await getSettings()
    const from = await yearDate(0)
    const to = await yearDate(300)
    const is = await incomeStatement(db, { from, to })
    const def = getReport('profit-loss')!
    const filters = await parseReportFilters(def, { period: 'custom', from, to }, { today: to, weekStartDay: settings.finance.weekStartDay, selected: null })
    const pl = await def.run(filters, { today: to, settings, user: admin })
    const profit = pl.rows.find((r) => r._style === 'total')!
    expect(D(String(profit.amount)).toString()).toBe(is.netIncome.toString())
    expect(is.netRevenue.minus(is.expenses.total).toString()).toBe(is.netIncome.toString())

    const bs = await balanceSheet(db, { asOf: to })
    expect(bs.balanced).toBe(true)
    expect(bs.assets.total.toString()).toBe(bs.totalLiabilitiesEquity.toString())
  })

  it('runs the accounting report definitions', async () => {
    const settings = await getSettings()
    const today = await yearDate(40)
    for (const id of ['trial-balance', 'balance-sheet']) {
      const def = getReport(id)!
      const filters = await parseReportFilters(def, {}, { today, weekStartDay: settings.finance.weekStartDay, selected: null })
      const res = await def.run(filters, { today, settings, user: admin })
      expect(res.rows.length, id).toBeGreaterThan(0)
      expect(res.summary?.find((s) => s.label === 'الحالة')?.value, id).toMatch(/✓/)
    }
  })
})
