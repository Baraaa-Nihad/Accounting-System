import 'server-only'
import type { Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { createChildAccount } from '../ledger/accounts'
import { toDb } from '@/lib/money'

/**
 * التصنيفات الديناميكية: إنشاء تصنيف جديد (ذمة، مصروف، إيراد) يُنشئ حسابه المحاسبي تلقائيًا.
 */

export async function saveChargeType(
  tx: Tx,
  ctx: Ctx,
  input: { id?: number | null; name: string; defaultAmount?: string | null; allowInstallments: boolean; isActive: boolean; description?: string | null; sortOrder?: number },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم التصنيف مطلوب')
  const clash = await tx.chargeType.findFirst({ where: { name, ...(input.id ? { id: { not: input.id } } : {}) } })
  if (clash) throw new BusinessError('يوجد تصنيف بنفس الاسم')
  if (input.id) {
    const before = await tx.chargeType.findUniqueOrThrow({ where: { id: input.id } })
    if (before.systemKey && !input.isActive) throw new BusinessError('لا يمكن تعطيل تصنيف نظامي')
    const after = await tx.chargeType.update({
      where: { id: input.id },
      data: {
        name: before.systemKey ? before.name : name,
        defaultAmount: input.defaultAmount ? toDb(input.defaultAmount) : null,
        allowInstallments: input.allowInstallments,
        isActive: input.isActive,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? before.sortOrder,
      },
    })
    await audit(tx, ctx, { action: 'update', entityType: 'ChargeType', entityId: after.id, entityLabel: after.name, before, after })
    return after
  }
  const account = await createChildAccount(tx, 'STUDENT_REVENUE_GROUP', `إيرادات ${name}`)
  const created = await tx.chargeType.create({
    data: {
      name,
      revenueAccountId: account.id,
      defaultAmount: input.defaultAmount ? toDb(input.defaultAmount) : null,
      allowInstallments: input.allowInstallments,
      isActive: input.isActive,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? (await tx.chargeType.count()) + 1,
    },
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'ChargeType',
    entityId: created.id,
    entityLabel: name,
    summary: `إضافة تصنيف ذمة «${name}» مع حساب الإيراد ${account.code}`,
    after: created,
  })
  return created
}

export async function saveDiscountType(
  tx: Tx,
  ctx: Ctx,
  input: { id?: number | null; name: string; defaultMethod?: 'PERCENT' | 'FIXED' | null; defaultValue?: string | null; isActive: boolean; description?: string | null },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم نوع الخصم مطلوب')
  const clash = await tx.discountType.findFirst({ where: { name, ...(input.id ? { id: { not: input.id } } : {}) } })
  if (clash) throw new BusinessError('يوجد نوع خصم بنفس الاسم')
  const data = {
    name,
    defaultMethod: input.defaultMethod ?? null,
    defaultValue: input.defaultValue ? toDb(input.defaultValue) : null,
    isActive: input.isActive,
    description: input.description ?? null,
  }
  const before = input.id ? await tx.discountType.findUnique({ where: { id: input.id } }) : null
  const after = input.id
    ? await tx.discountType.update({ where: { id: input.id }, data })
    : await tx.discountType.create({ data: { ...data, sortOrder: (await tx.discountType.count()) + 1 } })
  await audit(tx, ctx, { action: input.id ? 'update' : 'create', entityType: 'DiscountType', entityId: after.id, entityLabel: after.name, before, after })
  return after
}

/** تصنيف مصروف أو إيراد آخر = حساب فرعي في دليل الحسابات. */
export async function saveCategoryAccount(
  tx: Tx,
  ctx: Ctx,
  input: { id?: number | null; kind: 'EXPENSE' | 'OTHER_REVENUE'; name: string; isActive: boolean; description?: string | null },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new BusinessError('اسم التصنيف مطلوب')
  if (input.id) {
    const before = await tx.account.findUniqueOrThrow({ where: { id: input.id } })
    if (before.isGroup) throw new BusinessError('لا يمكن تعديل حساب تجميعي هنا')
    if (before.systemKey && !input.isActive) throw new BusinessError('لا يمكن تعطيل حساب نظامي')
    const after = await tx.account.update({
      where: { id: input.id },
      data: { name, isActive: input.isActive, description: input.description ?? null },
    })
    await audit(tx, ctx, { action: 'update', entityType: 'Account', entityId: after.id, entityLabel: `${after.code} ${after.name}`, before, after })
    return after
  }
  const parent = input.kind === 'EXPENSE' ? 'OPERATING_EXPENSES_GROUP' : 'OTHER_REVENUE_GROUP'
  const created = await createChildAccount(tx, parent, name, { description: input.description ?? undefined })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Account',
    entityId: created.id,
    entityLabel: `${created.code} ${created.name}`,
    summary: `إضافة تصنيف ${input.kind === 'EXPENSE' ? 'مصروف' : 'إيراد'} «${name}» (حساب ${created.code})`,
    after: created,
  })
  return created
}
