import { describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { verifyPassword } from '@/server/auth/password'
import { createUser, deleteRole, endUserSessions, resetUserPassword, saveRole, unlockUser, updateUser } from '@/server/services/users'
import { deletePartner, listPartners, savePartner } from '@/server/services/partners'
import { createOtherReceipt } from '@/server/services/receipts'
import { createVoucher } from '@/server/services/vouchers'
import { statementTarget, targetStatement } from '@/server/ledger/party-statements'
import { ADMIN_ROLE_KEY, ALL_PERMISSIONS, effectivePermissions } from '@/lib/permissions'
import type { Ctx } from '@/server/context'
import { testCtx } from './support/helpers'
import { trialBalanceDiff, yearDate } from './support/fixtures'

const ctx = testCtx()
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
const role = (key: string) => db.role.findUniqueOrThrow({ where: { key } })

async function newUser(roleKey = 'clerk', extra: Partial<{ extraPermissions: string[]; revokedPermissions: string[] }> = {}) {
  const r = await role(roleKey)
  return transaction((tx) =>
    createUser(tx, ctx, {
      username: `u.${uid()}`,
      fullName: 'مستخدم اختبار',
      email: null,
      phone: null,
      roleId: r.id,
      extraPermissions: (extra.extraPermissions ?? []) as never,
      revokedPermissions: (extra.revokedPermissions ?? []) as never,
      password: 'Temp-1234x',
    }),
  )
}

function ctxOf(user: { id: number; fullName: string }): Ctx {
  return { userId: user.id, userName: user.fullName, ip: null, userAgent: null, permissions: new Set(ALL_PERMISSIONS) }
}

describe('users', () => {
  it('creates users with a forced password change and normalized customization', async () => {
    const clerk = await role('clerk')
    // receipts.create موجودة في الدور (إضافتها لا معنى لها)، وaudit.view غير موجودة (حجبها لا معنى له)
    const u = await newUser('clerk', { extraPermissions: ['receipts.create', 'reports.export'], revokedPermissions: ['audit.view', 'vouchers.create'] })
    expect(u.mustChangePassword).toBe(true)
    expect(u.extraPermissions).toEqual(['reports.export'])
    expect(u.revokedPermissions).toEqual(['vouchers.create'])
    const perms = effectivePermissions({ roleKey: clerk.key, rolePermissions: clerk.permissions, extraPermissions: u.extraPermissions, revokedPermissions: u.revokedPermissions })
    expect(perms.has('reports.export')).toBe(true)
    expect(perms.has('vouchers.create')).toBe(false)
    expect(await verifyPassword('Temp-1234x', u.passwordHash)).toBe(true)
    const log = await db.auditLog.findFirst({ where: { entityType: 'User', entityId: String(u.id), action: 'create' } })
    expect(JSON.stringify(log?.after)).not.toContain('passwordHash')

    await expect(transaction((tx) => createUser(tx, ctx, { username: u.username, fullName: 'x', email: null, phone: null, roleId: clerk.id, extraPermissions: [], revokedPermissions: [], password: 'Temp-1234x' }))).rejects.toThrow(/مستخدم مسبقًا/)
    await expect(transaction((tx) => createUser(tx, ctx, { username: `w.${uid()}`, fullName: 'x', email: null, phone: null, roleId: clerk.id, extraPermissions: [], revokedPermissions: [], password: 'short' }))).rejects.toThrow(/8 أحرف/)
  })

  it('records permission changes and ends sessions on deactivation', async () => {
    const u = await newUser('clerk')
    await db.session.create({ data: { id: `s${uid()}`.padEnd(64, '0').slice(0, 64), userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } })
    const accountant = await role('accountant')
    await transaction((tx) => updateUser(tx, ctx, u.id, { fullName: u.fullName, email: null, phone: null, roleId: accountant.id, extraPermissions: [], revokedPermissions: ['payroll.pay'], isActive: false }))
    const logs = await db.auditLog.findMany({ where: { entityType: 'User', entityId: String(u.id) }, orderBy: { id: 'asc' } })
    const perm = logs.find((l) => l.action === 'permissions')
    expect(perm?.summary).toMatch(/الدور من «موظف مالي» إلى «محاسب»/)
    expect(perm?.summary).toContain('+ ')
    expect(logs.some((l) => l.action === 'status')).toBe(true)
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0)
  })

  it('protects the last active admin and the acting user', async () => {
    const admin = await role(ADMIN_ROLE_KEY)
    const clerk = await role('clerk')
    const a = await newUser(ADMIN_ROLE_KEY)
    const me = ctxOf(a)
    await expect(transaction((tx) => updateUser(tx, me, a.id, { fullName: a.fullName, email: null, phone: null, roleId: admin.id, extraPermissions: [], revokedPermissions: [], isActive: false }))).rejects.toThrow(/تعطيل حسابك/)
    await expect(transaction((tx) => updateUser(tx, me, a.id, { fullName: a.fullName, email: null, phone: null, roleId: clerk.id, extraPermissions: [], revokedPermissions: [], isActive: true }))).rejects.toThrow(/إدارة المستخدمين/)

    // تعطيل كل المديرين الآخرين مؤقتًا غير ممكن هنا (بيانات مشتركة)، لذا نتحقق من القاعدة مباشرة:
    const others = await db.user.count({ where: { isActive: true, id: { not: a.id }, role: { key: ADMIN_ROLE_KEY } } })
    expect(others).toBeGreaterThan(0)
    // خفض دور مدير (مع وجود مديرين آخرين) مسموح
    await transaction((tx) => updateUser(tx, ctx, a.id, { fullName: a.fullName, email: null, phone: null, roleId: clerk.id, extraPermissions: [], revokedPermissions: [], isActive: true }))
    // المدير الوحيد: نحاكيه بتعطيل كل المديرين داخل معاملة ثم نتراجع عنها
    await expect(
      transaction(async (tx) => {
        const target = await tx.user.findFirstOrThrow({ where: { isActive: true, role: { key: ADMIN_ROLE_KEY } } })
        await tx.user.updateMany({ where: { id: { not: target.id }, role: { key: ADMIN_ROLE_KEY } }, data: { isActive: false } })
        await updateUser(tx, ctx, target.id, { fullName: target.fullName, email: null, phone: null, roleId: clerk.id, extraPermissions: [], revokedPermissions: [], isActive: true })
      }),
    ).rejects.toThrow(/آخر مدير نظام/)
    expect(await db.user.count({ where: { isActive: true, role: { key: ADMIN_ROLE_KEY } } })).toBeGreaterThan(0)
  })

  it('resets passwords, unlocks and ends sessions', async () => {
    const u = await newUser()
    await db.user.update({ where: { id: u.id }, data: { mustChangePassword: false, lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 3 } })
    await db.session.create({ data: { id: `r${uid()}`.padEnd(64, '1').slice(0, 64), userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } })
    await transaction((tx) => unlockUser(tx, ctx, u.id))
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ lockedUntil: null, failedLoginCount: 0 })
    await transaction((tx) => resetUserPassword(tx, ctx, u.id, 'NewPass-987'))
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(after.mustChangePassword).toBe(true)
    expect(await verifyPassword('NewPass-987', after.passwordHash)).toBe(true)
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0)
    await expect(transaction((tx) => resetUserPassword(tx, ctx, u.id, '12345678'))).rejects.toThrow(/أحرف وأرقام/)
    expect(await transaction((tx) => endUserSessions(tx, ctx, u.id))).toBe(0)
  })
})

describe('roles', () => {
  it('keeps the admin role fixed, applies role edits, and deletes only unused custom roles', async () => {
    const admin = await role(ADMIN_ROLE_KEY)
    await expect(transaction((tx) => saveRole(tx, ctx, { id: admin.id, name: admin.name, description: null, permissions: ['dashboard.view'] }))).rejects.toThrow(/لا يمكن تعديله/)
    const r = await transaction((tx) => saveRole(tx, ctx, { name: `دور ${uid()}`, description: 'اختبار', permissions: ['dashboard.view', 'students.view'] }))
    const u = await newUser('clerk')
    await transaction((tx) => updateUser(tx, ctx, u.id, { fullName: u.fullName, email: null, phone: null, roleId: r.id, extraPermissions: [], revokedPermissions: [], isActive: true }))
    await expect(transaction((tx) => deleteRole(tx, ctx, r.id))).rejects.toThrow(/مستخدم من 1/)
    const edited = await transaction((tx) => saveRole(tx, ctx, { id: r.id, name: r.name, description: null, permissions: ['dashboard.view', 'receipts.view'] }))
    expect(edited.permissions).toEqual(['dashboard.view', 'receipts.view'])
    const log = await db.auditLog.findFirst({ where: { entityType: 'Role', entityId: String(r.id), action: 'permissions' }, orderBy: { id: 'desc' } })
    expect(log?.summary).toMatch(/\+ عرض سندات القبض/)
    expect(log?.summary).toMatch(/− عرض الطلاب/)
    const clerkId = (await role('clerk')).id
    await transaction((tx) => updateUser(tx, ctx, u.id, { fullName: u.fullName, email: null, phone: null, roleId: clerkId, extraPermissions: [], revokedPermissions: [], isActive: true }))
    await transaction((tx) => deleteRole(tx, ctx, r.id))
    expect(await db.role.findUnique({ where: { id: r.id } })).toBeNull()
    await expect(transaction(async (tx) => deleteRole(tx, ctx, (await role('clerk')).id))).rejects.toThrow(/الأساسية/)
  })
})

describe('partners', () => {
  it('creates capital and current accounts, tracks capital and withdrawals, and caps ownership at 100%', async () => {
    // نسبة صفرية حتى لا يتأثر مجموع النسب بتكرار الاختبار
    const name = `شريك ${uid()}`
    const p = await transaction((tx) => savePartner(tx, ctx, { name, phone: null, email: null, ownershipPercent: 0, userId: null, joinDate: null, notes: null, isActive: true }))
    const [cap, cur] = await Promise.all([db.account.findUniqueOrThrow({ where: { id: p.capitalAccountId! } }), db.account.findUniqueOrThrow({ where: { id: p.drawingsAccountId! } })])
    expect(cap.code.startsWith('31')).toBe(true)
    expect(cur.code.startsWith('32')).toBe(true)
    expect(cap.name).toBe(`رأس مال — ${name}`)
    await expect(transaction((tx) => savePartner(tx, ctx, { id: p.id, name, phone: null, email: null, ownershipPercent: 101, userId: null, joinDate: null, notes: null, isActive: true }))).rejects.toThrow()
    const others = await db.partner.findMany({ where: { isActive: true, id: { not: p.id } } })
    const free = 100 - others.reduce((a, x) => a + Number(x.ownershipPercent), 0)
    await expect(transaction((tx) => savePartner(tx, ctx, { id: p.id, name, phone: null, email: null, ownershipPercent: free + 0.5, userId: null, joinDate: null, notes: null, isActive: true }))).rejects.toThrow(/أكثر من 100%/)

    const box = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    const date = await yearDate(3)
    await transaction((tx) => createOtherReceipt(tx, ctx, { kind: 'PARTNER_CAPITAL', partnerId: p.id, date, amount: '10000', paymentMethod: 'CASH', cashAccountId: box.id, payerName: name }))
    await transaction((tx) => createVoucher(tx, ctx, { kind: 'PARTNER_WITHDRAWAL', partnerId: p.id, date, amount: '2500', paymentMethod: 'CASH', cashAccountId: box.id }))
    const row = (await listPartners(db)).find((x) => x.id === p.id)!
    expect(row.capital.toString()).toBe('10000')
    expect(row.withdrawals.toString()).toBe('2500')
    expect(row.equity.toString()).toBe('7500')
    const target = (await statementTarget(db, 'partner', p.id))!
    const st = await targetStatement(db, target, {})
    expect(st.rows).toHaveLength(2)
    expect(st.closing.toString()).toBe('7500')

    // تغيير الاسم يغيّر أسماء الحسابات
    await transaction((tx) => savePartner(tx, ctx, { id: p.id, name: `${name} ب`, phone: null, email: null, ownershipPercent: 0, userId: null, joinDate: null, notes: null, isActive: true }))
    expect((await db.account.findUniqueOrThrow({ where: { id: p.drawingsAccountId! } })).name).toBe(`جاري — ${name} ب`)
    expect(await trialBalanceDiff()).toBe(0)
    await expect(transaction((tx) => deletePartner(tx, ctx, p.id))).rejects.toThrow(/حركات مالية/)
  })

  it('deletes a partner added by mistake (no movements) together with its accounts', async () => {
    const p = await transaction((tx) => savePartner(tx, ctx, { name: `شريك خطأ ${uid()}`, phone: null, email: null, ownershipPercent: 0, userId: null, joinDate: null, notes: null, isActive: true }))
    await transaction((tx) => deletePartner(tx, ctx, p.id))
    expect(await db.partner.findUnique({ where: { id: p.id } })).toBeNull()
    expect(await db.account.count({ where: { id: { in: [p.capitalAccountId!, p.drawingsAccountId!] } } })).toBe(0)
    expect(await db.auditLog.count({ where: { entityType: 'Partner', entityId: String(p.id), action: 'delete' } })).toBe(1)
  })
})
