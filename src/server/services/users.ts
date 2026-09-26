import 'server-only'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { hashPassword, passwordProblem } from '../auth/password'
import { ADMIN_ROLE_KEY, PERMISSIONS, effectivePermissions, type Permission } from '@/lib/permissions'

/**
 * المستخدمون والأدوار (docs/04-roles-permissions.md):
 * الصلاحية الفعلية = (صلاحيات الدور ∪ المضافة) − المحجوبة، ومدير النظام يملك الكل دائمًا.
 * كل تغيير في الأدوار والصلاحيات يُسجل كعملية حساسة، ولا يمكن تعطيل آخر مدير نظام فعّال.
 */

export interface UserInput {
  fullName: string
  email: string | null
  phone: string | null
  roleId: number
  extraPermissions: Permission[]
  revokedPermissions: Permission[]
}

const permLabel = (p: string) => PERMISSIONS[p as Permission] ?? p

/** تنظيف التخصيص: المضافة = غير الموجودة في الدور فقط، والمحجوبة = الموجودة فيه فقط. */
function normalizeCustomization(role: { key: string | null; permissions: string[] }, extra: Permission[], revoked: Permission[]) {
  if (role.key === ADMIN_ROLE_KEY) return { extra: [] as Permission[], revoked: [] as Permission[] }
  const inRole = new Set(role.permissions)
  return { extra: extra.filter((p) => !inRole.has(p)), revoked: revoked.filter((p) => inRole.has(p)) }
}

function permsOf(role: { key: string | null; permissions: string[] }, extra: string[], revoked: string[]) {
  return effectivePermissions({ roleKey: role.key, rolePermissions: role.permissions, extraPermissions: extra, revokedPermissions: revoked })
}

async function loadRole(client: DbOrTx, roleId: number) {
  const role = await client.role.findUnique({ where: { id: roleId } })
  if (!role) throw new BusinessError('الدور غير موجود', { roleId: 'اختر الدور' })
  return role
}

async function otherActiveAdmins(client: DbOrTx, exceptUserId: number) {
  return client.user.count({ where: { isActive: true, id: { not: exceptUserId }, role: { key: ADMIN_ROLE_KEY } } })
}

/** وصف مختصر لفرق الصلاحيات لسجل النشاط. */
function permissionDiff(before: Set<Permission>, after: Set<Permission>) {
  const added = [...after].filter((p) => !before.has(p))
  const removed = [...before].filter((p) => !after.has(p))
  const parts = [...added.map((p) => `+ ${permLabel(p)}`), ...removed.map((p) => `− ${permLabel(p)}`)]
  return { added, removed, text: parts.join('، ') }
}

export async function createUser(tx: Tx, ctx: Ctx, input: UserInput & { username: string; password: string }) {
  const username = input.username.trim().toLowerCase()
  if (await tx.user.findUnique({ where: { username } })) throw new BusinessError('اسم المستخدم مستخدم مسبقًا', { username: 'مستخدم مسبقًا' })
  const problem = passwordProblem(input.password)
  if (problem) throw new BusinessError(problem, { password: problem })
  const role = await loadRole(tx, input.roleId)
  const { extra, revoked } = normalizeCustomization(role, input.extraPermissions, input.revokedPermissions)
  const user = await tx.user.create({
    data: {
      username,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      roleId: role.id,
      extraPermissions: extra,
      revokedPermissions: revoked,
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
    },
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'User',
    entityId: user.id,
    entityLabel: `${user.fullName} (${user.username})`,
    summary: `إضافة المستخدم ${user.fullName} (${user.username}) بدور «${role.name}»${extra.length || revoked.length ? ' مع صلاحيات مخصصة' : ''}`,
    after: { ...user, role: role.name, effectivePermissions: [...permsOf(role, extra, revoked)] },
  })
  return user
}

export async function updateUser(tx: Tx, ctx: Ctx, id: number, input: UserInput & { isActive: boolean }) {
  const before = await tx.user.findUnique({ where: { id }, include: { role: true } })
  if (!before) throw new BusinessError('المستخدم غير موجود')
  const role = await loadRole(tx, input.roleId)
  const { extra, revoked } = normalizeCustomization(role, input.extraPermissions, input.revokedPermissions)
  const beforePerms = permsOf(before.role, before.extraPermissions, before.revokedPermissions)
  const afterPerms = permsOf(role, extra, revoked)

  if (id === ctx.userId) {
    if (!input.isActive) throw new BusinessError('لا يمكنك تعطيل حسابك')
    if (!afterPerms.has('users.manage')) throw new BusinessError('لا يمكنك إزالة صلاحية إدارة المستخدمين من حسابك (حتى لا تفقد الوصول)')
  }
  const wasActiveAdmin = before.isActive && before.role.key === ADMIN_ROLE_KEY
  const staysActiveAdmin = input.isActive && role.key === ADMIN_ROLE_KEY
  if (wasActiveAdmin && !staysActiveAdmin && (await otherActiveAdmins(tx, id)) === 0) {
    throw new BusinessError('لا يمكن تعطيل أو تغيير دور آخر مدير نظام فعّال. أضف مديرًا آخر أولًا.')
  }

  const after = await tx.user.update({
    where: { id },
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      roleId: role.id,
      extraPermissions: extra,
      revokedPermissions: revoked,
      isActive: input.isActive,
    },
  })
  if (before.isActive && !input.isActive) await tx.session.deleteMany({ where: { userId: id } })

  const label = `${after.fullName} (${after.username})`
  const diff = permissionDiff(beforePerms, afterPerms)
  if (before.roleId !== role.id || diff.text) {
    await audit(tx, ctx, {
      action: 'permissions',
      entityType: 'User',
      entityId: id,
      entityLabel: label,
      summary: `تغيير صلاحيات المستخدم ${label}${before.roleId !== role.id ? ` — الدور من «${before.role.name}» إلى «${role.name}»` : ''}${diff.text ? ` — ${diff.text}` : ''}`,
      before: { role: before.role.name, extraPermissions: before.extraPermissions, revokedPermissions: before.revokedPermissions, effectivePermissions: [...beforePerms] },
      after: { role: role.name, extraPermissions: extra, revokedPermissions: revoked, effectivePermissions: [...afterPerms] },
    })
  }
  if (before.isActive !== input.isActive) {
    await audit(tx, ctx, {
      action: 'status',
      entityType: 'User',
      entityId: id,
      entityLabel: label,
      summary: `${input.isActive ? 'تفعيل' : 'تعطيل'} المستخدم ${label}${input.isActive ? '' : ' وإنهاء جلساته'}`,
    })
  }
  if (before.fullName !== after.fullName || before.email !== after.email || before.phone !== after.phone) {
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'User',
      entityId: id,
      entityLabel: label,
      before: { fullName: before.fullName, email: before.email, phone: before.phone },
      after: { fullName: after.fullName, email: after.email, phone: after.phone },
    })
  }
  return after
}

/** إعادة تعيين كلمة المرور من المدير: تُطلب كلمة جديدة عند أول دخول، وتُنهى كل الجلسات. */
export async function resetUserPassword(tx: Tx, ctx: Ctx, id: number, password: string) {
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new BusinessError('المستخدم غير موجود')
  const problem = passwordProblem(password)
  if (problem) throw new BusinessError(problem, { password: problem })
  await tx.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  })
  await tx.session.deleteMany({ where: { userId: id } })
  await audit(tx, ctx, {
    action: 'password',
    entityType: 'User',
    entityId: id,
    entityLabel: `${user.fullName} (${user.username})`,
    summary: `إعادة تعيين كلمة مرور المستخدم ${user.username} (يُطلب تغييرها عند الدخول) وإنهاء جلساته`,
  })
}

export async function unlockUser(tx: Tx, ctx: Ctx, id: number) {
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new BusinessError('المستخدم غير موجود')
  await tx.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } })
  await audit(tx, ctx, { action: 'unlock', entityType: 'User', entityId: id, entityLabel: user.username, summary: `فك قفل حساب ${user.username}` })
}

/** إنهاء جلسات مستخدم (كلها أو جلسة واحدة). */
export async function endUserSessions(tx: Tx, ctx: Ctx, userId: number, sessionId?: string | null) {
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user) throw new BusinessError('المستخدم غير موجود')
  const res = await tx.session.deleteMany({ where: { userId, ...(sessionId ? { id: sessionId } : {}) } })
  await audit(tx, ctx, {
    action: 'sessions',
    entityType: 'User',
    entityId: userId,
    entityLabel: user.username,
    summary: `إنهاء ${sessionId ? 'جلسة' : `${res.count} جلسة`} للمستخدم ${user.username}`,
  })
  return res.count
}

// ---------------------------------------------------------------------
// الأدوار
// ---------------------------------------------------------------------

export async function saveRole(tx: Tx, ctx: Ctx, input: { id?: number | null; name: string; description: string | null; permissions: Permission[] }) {
  const clash = await tx.role.findFirst({ where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) } })
  if (clash) throw new BusinessError('يوجد دور بنفس الاسم', { name: 'الاسم مستخدم' })
  if (input.id) {
    const before = await tx.role.findUnique({ where: { id: input.id } })
    if (!before) throw new BusinessError('الدور غير موجود')
    if (before.key === ADMIN_ROLE_KEY) throw new BusinessError('دور «مدير النظام» يملك كل الصلاحيات دائمًا ولا يمكن تعديله')
    // لا يفقد المستخدم الحالي إدارة المستخدمين بتعديل دوره
    const self = ctx.userId ? await tx.user.findUnique({ where: { id: ctx.userId }, include: { role: true } }) : null
    if (self && self.roleId === before.id) {
      const next = permsOf({ key: before.key, permissions: input.permissions }, self.extraPermissions, self.revokedPermissions)
      if (!next.has('users.manage')) throw new BusinessError('هذا دورك: لا يمكنك إزالة صلاحية إدارة المستخدمين منه')
    }
    const after = await tx.role.update({ where: { id: before.id }, data: { name: input.name, description: input.description, permissions: input.permissions } })
    const diff = permissionDiff(new Set(before.permissions as Permission[]), new Set(input.permissions))
    await audit(tx, ctx, {
      action: 'permissions',
      entityType: 'Role',
      entityId: after.id,
      entityLabel: after.name,
      summary: `تعديل الدور «${after.name}»${diff.text ? ` — ${diff.text}` : ''}`,
      before,
      after,
    })
    return after
  }
  const role = await tx.role.create({ data: { name: input.name, description: input.description, permissions: input.permissions } })
  await audit(tx, ctx, { action: 'create', entityType: 'Role', entityId: role.id, entityLabel: role.name, summary: `إضافة الدور «${role.name}» (${input.permissions.length} صلاحية)`, after: role })
  return role
}

/** حذف دور غير مستخدم (الأدوار الأساسية لا تُحذف). */
export async function deleteRole(tx: Tx, ctx: Ctx, id: number) {
  const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } })
  if (!role) throw new BusinessError('الدور غير موجود')
  if (role.isSystem || role.key) throw new BusinessError('الأدوار الأساسية لا تُحذف (يمكن تعديل صلاحياتها)')
  if (role._count.users > 0) throw new BusinessError(`الدور مستخدم من ${role._count.users} مستخدم. انقلهم لدور آخر أولًا`)
  await tx.role.delete({ where: { id } })
  await audit(tx, ctx, { action: 'delete', entityType: 'Role', entityId: id, entityLabel: role.name, summary: `حذف الدور «${role.name}»`, before: role })
}

// ---------------------------------------------------------------------
// القوائم
// ---------------------------------------------------------------------

export type UserState = 'active' | 'locked' | 'disabled' | 'must_change'

export function userState(u: { isActive: boolean; lockedUntil: Date | null; mustChangePassword: boolean }, now = new Date()): UserState {
  if (!u.isActive) return 'disabled'
  if (u.lockedUntil && u.lockedUntil > now) return 'locked'
  if (u.mustChangePassword) return 'must_change'
  return 'active'
}

export async function listUsers(client: DbOrTx, filters?: { q?: string; roleId?: number; state?: string }) {
  const now = new Date()
  const q = filters?.q?.trim()
  const users = await client.user.findMany({
    where: {
      ...(q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(filters?.roleId ? { roleId: filters.roleId } : {}),
    },
    include: { role: true, partner: { select: { id: true, name: true } }, _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } } },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
  })
  const rows = users.map((u) => ({ ...u, state: userState(u, now), activeSessions: u._count.sessions }))
  return filters?.state ? rows.filter((r) => r.state === filters.state) : rows
}

export async function listRoles(client: DbOrTx) {
  return client.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: [{ isSystem: 'desc' }, { id: 'asc' }] })
}
