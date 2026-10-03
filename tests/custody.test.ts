import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import type { Ctx } from '@/server/context'
import { createUser } from '@/server/services/users'
import { deletePartner, savePartner } from '@/server/services/partners'
import { boxAccess, boxOptionsFor, cashAccountsSummary, createCashAccount, createTransfer, updateCashAccount } from '@/server/services/treasury'
import { createStudentReceipt } from '@/server/services/receipts'
import { createVoucher } from '@/server/services/vouchers'
import { saveCategoryAccount } from '@/server/services/categories'
import { effectivePermissions, type Permission } from '@/lib/permissions'
import { testCtx } from './support/helpers'
import { makeStudent, trialBalanceDiff, yearDate } from './support/fixtures'

/**
 * عهدة الصناديق: صندوق لكل موظف وصندوق لكل شريك.
 * صاحب العهدة (بلا صلاحية «كل الصناديق») يقبض ويصرف ويحوّل من صناديقه فقط، والبنوك مفتوحة للجميع.
 */

const admin = testCtx()
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 100000)}`

async function clerk(extra: Permission[] = []) {
  const role = await db.role.findUniqueOrThrow({ where: { key: 'clerk' } })
  const user = await transaction((tx) =>
    createUser(tx, admin, {
      username: `box.${uid()}`,
      fullName: `أمين صندوق ${uid()}`,
      email: null,
      phone: null,
      roleId: role.id,
      extraPermissions: extra,
      revokedPermissions: [],
      password: 'Temp-1234x',
    }),
  )
  const permissions = effectivePermissions({ roleKey: role.key, rolePermissions: role.permissions, extraPermissions: user.extraPermissions, revokedPermissions: user.revokedPermissions })
  const ctx: Ctx = { userId: user.id, userName: user.fullName, ip: null, userAgent: null, permissions }
  return { user, ctx }
}

async function box(input: { opening?: string; type?: 'CASHBOX' | 'BANK'; custodianId?: number | null; partnerId?: number | null } = {}) {
  const date = await yearDate(1)
  return transaction((tx) =>
    createCashAccount(tx, admin, {
      name: `${input.type === 'BANK' ? 'بنك' : 'صندوق'} عهدة ${uid()}`,
      type: input.type ?? 'CASHBOX',
      openingBalance: input.opening ?? '0',
      openingDate: date,
      custodianId: input.custodianId ?? null,
      partnerId: input.partnerId ?? null,
    }),
  )
}

async function newPartner(userId: number | null = null) {
  return transaction((tx) =>
    savePartner(tx, admin, { name: `شريك عهدة ${uid()}`, phone: null, email: null, ownershipPercent: 0, userId, joinDate: null, notes: null, isActive: true }),
  )
}

describe('cash box custody', () => {
  it('limits an employee with a box to it for receipts, vouchers and transfers, while banks stay open', async () => {
    const { user, ctx } = await clerk()
    const mine = await box({ custodianId: user.id })
    const main = await box({ opening: '500' })
    const bank = await box({ type: 'BANK' })
    const student = await makeStudent()
    const date = await yearDate(5)

    const receive = (cashAccountId: number, paymentMethod: 'CASH' | 'BANK_TRANSFER' = 'CASH') =>
      transaction((tx) => createStudentReceipt(tx, ctx, { kind: 'STUDENT', studentId: student.id, date, amount: '100', paymentMethod, cashAccountId, confirmCredit: true }))
    await receive(mine.id)
    await expect(receive(main.id)).rejects.toThrow(/ليس في عهدتك/)
    await receive(bank.id, 'BANK_TRANSFER')

    const category = await transaction((tx) => saveCategoryAccount(tx, admin, { kind: 'EXPENSE', name: `مصروف عهدة ${uid()}`, isActive: true }))
    const pay = (cashAccountId: number) =>
      transaction((tx) => createVoucher(tx, ctx, { kind: 'EXPENSE', date, amount: '40', paymentMethod: 'CASH', cashAccountId, expenseAccountId: category.id, payeeName: 'مورد' }))
    await expect(pay(main.id)).rejects.toThrow(/ليس في عهدتك/)
    await pay(mine.id)

    // تسليم النقدية: من صندوقه إلى أي صندوق، لا من صناديق غيره
    const transfer = (fromAccountId: number, toAccountId: number) => transaction((tx) => createTransfer(tx, ctx, { date, fromAccountId, toAccountId, amount: '60' }))
    await expect(transfer(main.id, mine.id)).rejects.toThrow(/ليس في عهدتك/)
    await transfer(mine.id, main.id)

    const options = await boxOptionsFor(db, user.id, ctx.permissions)
    const ids = options.map((o) => o.id)
    expect(ids).toContain(mine.id)
    expect(ids).toContain(bank.id)
    expect(ids).not.toContain(main.id)
    expect(options.find((o) => o.isDefault)?.id).toBe(mine.id)
    expect(options.find((o) => o.id === mine.id)?.balance).toBe('0')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('leaves employees without a box, and holders of the all-boxes permission, free to use every box', async () => {
    const main = await box({ opening: '100' })
    const other = await box()
    const date = await yearDate(6)

    const free = await clerk()
    expect((await boxAccess(db, free.user.id, free.ctx.permissions)).restricted).toBe(false)
    await transaction((tx) => createTransfer(tx, free.ctx, { date, fromAccountId: main.id, toAccountId: other.id, amount: '10' }))

    const chief = await clerk(['treasury.all_boxes'])
    const chiefBox = await box({ custodianId: chief.user.id })
    expect((await boxAccess(db, chief.user.id, chief.ctx.permissions)).restricted).toBe(false)
    const options = await boxOptionsFor(db, chief.user.id, chief.ctx.permissions)
    expect(options.map((o) => o.id)).toContain(main.id)
    expect(options.find((o) => o.isDefault)?.id).toBe(chiefBox.id)
    await transaction((tx) => createTransfer(tx, chief.ctx, { date, fromAccountId: other.id, toAccountId: main.id, amount: '10' }))
  })

  it('gives a partner a box held through their user, shows it with the partner, and blocks deleting a linked partner', async () => {
    const { user, ctx } = await clerk()
    const partner = await newPartner(user.id)
    const partnerBox = await box({ partnerId: partner.id })

    const access = await boxAccess(db, user.id, ctx.permissions)
    expect(access.own).toEqual([partnerBox.id])
    expect(access.restricted).toBe(true)
    const row = (await cashAccountsSummary(db)).find((a) => a.id === partnerBox.id)!
    expect(row.partnerName).toBe(partner.name)
    expect(row.custodianName).toBeNull()

    await expect(transaction((tx) => deletePartner(tx, admin, partner.id))).rejects.toThrow(/مرتبط بالصندوق/)
    await transaction((tx) => updateCashAccount(tx, admin, partnerBox.id, { name: partnerBox.name, isActive: true, custodianId: null, partnerId: null }))
    expect(await db.auditLog.count({ where: { entityType: 'CashAccount', entityId: String(partnerBox.id), summary: { contains: 'بلا عهدة' } } })).toBe(1)
    await transaction((tx) => deletePartner(tx, admin, partner.id))
    expect((await boxAccess(db, user.id, ctx.permissions)).restricted).toBe(false)
  })

  it('validates the custodian, and the database rejects invalid custody', async () => {
    const { user } = await clerk()
    const partner = await newPartner()
    await expect(box({ custodianId: user.id, partnerId: partner.id })).rejects.toThrow(/شخص واحد/)
    await expect(box({ type: 'BANK', custodianId: user.id })).rejects.toThrow(/للصناديق النقدية فقط/)
    const off = await clerk()
    await db.user.update({ where: { id: off.user.id }, data: { isActive: false } })
    await expect(box({ custodianId: off.user.id })).rejects.toThrow(/غير فعال/)

    const plain = await box()
    await expect(db.cashAccount.update({ where: { id: plain.id }, data: { custodianId: user.id, partnerId: partner.id } })).rejects.toThrow()
    const bank = await box({ type: 'BANK' })
    await expect(db.cashAccount.update({ where: { id: bank.id }, data: { custodianId: user.id } })).rejects.toThrow()
    await transaction((tx) => savePartner(tx, admin, { id: partner.id, name: partner.name, phone: null, email: null, ownershipPercent: 0, userId: null, joinDate: null, notes: null, isActive: false }))
  })
})
