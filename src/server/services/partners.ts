import 'server-only'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { createChildAccount } from '../ledger/accounts'
import { accountsTotals } from '../ledger/balances'
import { D } from '@/lib/money'
import { fromDateOnly, type DateOnly } from '@/lib/dates'

/**
 * الشركاء (docs/05-workflows.md §5.22، docs/13-accounting.md):
 * لكل شريك حساب رأس مال (31xx) وحساب جاري (32xx) يُنشآن تلقائيًا،
 * ورأس المال بسند قبض «رأس مال شريك»، والسحب بسند صرف «سحب شريك».
 */

export interface PartnerInput {
  name: string
  phone: string | null
  email: string | null
  ownershipPercent: number
  userId: number | null
  joinDate: DateOnly | null
  notes: string | null
  isActive: boolean
}

async function assertOwnership(tx: Tx, percent: number, exceptId?: number) {
  const others = await tx.partner.findMany({ where: { isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { ownershipPercent: true } })
  const total = others.reduce((a, p) => a.plus(D(p.ownershipPercent)), D(percent))
  if (total.greaterThan(100)) {
    throw new BusinessError(`مجموع نسب ملكية الشركاء الفعالين سيصبح ${total.toString()}% (أكثر من 100%)`, { ownershipPercent: 'المجموع أكبر من 100%' })
  }
}

async function assertUserLink(tx: Tx, userId: number | null, exceptId?: number) {
  if (!userId) return
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user) throw new BusinessError('حساب المستخدم غير موجود', { userId: 'اختر المستخدم' })
  const linked = await tx.partner.findFirst({ where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) } })
  if (linked) throw new BusinessError(`المستخدم مرتبط بالشريك ${linked.name}`, { userId: 'مرتبط بشريك آخر' })
}

export async function savePartner(tx: Tx, ctx: Ctx, input: PartnerInput & { id?: number | null }) {
  if (input.isActive) await assertOwnership(tx, input.ownershipPercent, input.id ?? undefined)
  await assertUserLink(tx, input.userId, input.id ?? undefined)
  const data = {
    name: input.name,
    phone: input.phone,
    email: input.email,
    ownershipPercent: input.ownershipPercent.toString(),
    userId: input.userId,
    joinDate: input.joinDate ? fromDateOnly(input.joinDate) : null,
    notes: input.notes,
    isActive: input.isActive,
  }
  if (input.id) {
    const before = await tx.partner.findUnique({ where: { id: input.id } })
    if (!before) throw new BusinessError('الشريك غير موجود')
    const after = await tx.partner.update({ where: { id: before.id }, data })
    if (before.name !== after.name) {
      // أسماء الحسابات تتبع اسم الشريك
      if (after.capitalAccountId) await tx.account.update({ where: { id: after.capitalAccountId }, data: { name: `رأس مال — ${after.name}` } })
      if (after.drawingsAccountId) await tx.account.update({ where: { id: after.drawingsAccountId }, data: { name: `جاري — ${after.name}` } })
    }
    await audit(tx, ctx, {
      action: before.isActive !== after.isActive ? 'status' : 'update',
      entityType: 'Partner',
      entityId: after.id,
      entityLabel: after.name,
      summary:
        before.isActive !== after.isActive
          ? `${after.isActive ? 'تفعيل' : 'إيقاف'} الشريك ${after.name}`
          : !D(before.ownershipPercent).equals(D(after.ownershipPercent))
            ? `تعديل نسبة ملكية ${after.name} من ${before.ownershipPercent.toString()}% إلى ${after.ownershipPercent.toString()}%`
            : undefined,
      before,
      after,
    })
    return after
  }
  const capital = await createChildAccount(tx, 'PARTNERS_CAPITAL_GROUP', `رأس مال — ${input.name}`)
  const current = await createChildAccount(tx, 'PARTNERS_CURRENT_GROUP', `جاري — ${input.name}`)
  const partner = await tx.partner.create({ data: { ...data, capitalAccountId: capital.id, drawingsAccountId: current.id } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Partner',
    entityId: partner.id,
    entityLabel: partner.name,
    summary: `إضافة الشريك ${partner.name} بنسبة ${partner.ownershipPercent.toString()}% (حساب رأس المال ${capital.code} والجاري ${current.code})`,
    after: partner,
  })
  return partner
}

/** الشركاء مع أرصدتهم من الأستاذ: رأس المال (دائن)، الجاري (سحوبات مدينة/أرباح دائنة)، وصافي الحقوق. */
export async function listPartners(client: DbOrTx) {
  const partners = await client.partner.findMany({
    include: { user: { select: { id: true, username: true, fullName: true } }, capitalAccount: true, drawingsAccount: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  const ids = partners.flatMap((p) => [p.capitalAccountId, p.drawingsAccountId]).filter((x): x is number => x !== null)
  const totals = await accountsTotals(client, ids)
  return partners.map((p) => {
    const cap = p.capitalAccountId ? totals.get(p.capitalAccountId) : undefined
    const cur = p.drawingsAccountId ? totals.get(p.drawingsAccountId) : undefined
    const capital = cap ? cap.credit.minus(cap.debit) : D(0)
    const current = cur ? cur.credit.minus(cur.debit) : D(0)
    return { ...p, capital, current, withdrawals: cur ? cur.debit : D(0), equity: capital.plus(current) }
  })
}

/** هل للشريك حركات مالية (سندات أو أطراف قيود)؟ */
export async function partnerHasMovements(client: DbOrTx, partner: { id: number; capitalAccountId: number | null; drawingsAccountId: number | null }) {
  const accounts = [partner.capitalAccountId, partner.drawingsAccountId].filter((x): x is number => x !== null)
  const [receipts, vouchers, lines] = await Promise.all([
    client.receipt.count({ where: { partnerId: partner.id } }),
    client.paymentVoucher.count({ where: { partnerId: partner.id } }),
    client.journalLine.count({ where: { OR: [{ partnerId: partner.id }, ...(accounts.length ? [{ accountId: { in: accounts } }] : [])] } }),
  ])
  return receipts + vouchers + lines > 0
}

/** حذف شريك أُضيف بالخطأ (بلا أي حركة مالية) مع حسابيه. من له حركات يُعطّل ولا يُحذف. */
export async function deletePartner(tx: Tx, ctx: Ctx, id: number) {
  const p = await tx.partner.findUnique({ where: { id } })
  if (!p) throw new BusinessError('الشريك غير موجود')
  if (await partnerHasMovements(tx, p)) {
    throw new BusinessError('للشريك حركات مالية مسجلة، فلا يُحذف حفاظًا على السجل المالي. يمكنك إيقافه بدلًا من ذلك.')
  }
  await tx.partner.delete({ where: { id } })
  const accounts = [p.capitalAccountId, p.drawingsAccountId].filter((x): x is number => x !== null)
  if (accounts.length) await tx.account.deleteMany({ where: { id: { in: accounts } } })
  await audit(tx, ctx, { action: 'delete', entityType: 'Partner', entityId: id, entityLabel: p.name, summary: `حذف الشريك ${p.name} (لا توجد له حركات مالية) مع حسابيه`, before: p })
}
