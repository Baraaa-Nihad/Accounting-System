import 'server-only'
import type { AccountType } from '@/generated/prisma/enums'
import type { DbOrTx, Tx } from '../db'
import { BusinessError } from '../errors'
import type { SystemAccountKey } from './chart'

/**
 * الوصول لحسابات دليل الحسابات بالمفتاح النظامي، وإنشاء الحسابات الفرعية تلقائيًا
 * (تصنيف مصروف جديد، صندوق جديد، شريك جديد...).
 */

const keyCache = new Map<string, number>()

export function clearAccountCache() {
  keyCache.clear()
}

export async function accountIdByKey(client: DbOrTx, key: SystemAccountKey): Promise<number> {
  const cached = keyCache.get(key)
  if (cached) return cached
  const acc = await client.account.findUnique({ where: { systemKey: key }, select: { id: true } })
  if (!acc) throw new Error(`SYSTEM_ACCOUNT_MISSING:${key}`)
  keyCache.set(key, acc.id)
  return acc.id
}

export async function accountByKey(client: DbOrTx, key: SystemAccountKey) {
  const acc = await client.account.findUnique({ where: { systemKey: key } })
  if (!acc) throw new Error(`SYSTEM_ACCOUNT_MISSING:${key}`)
  return acc
}

/** رمز الحساب الفرعي التالي: رمز الأب + رقم من خانتين (4101، 4102...). */
async function nextChildCode(client: DbOrTx, parent: { id: number; code: string }): Promise<string> {
  const siblings = await client.account.findMany({
    where: { parentId: parent.id },
    select: { code: true },
  })
  let max = 0
  for (const s of siblings) {
    if (s.code.startsWith(parent.code)) {
      const suffix = Number(s.code.slice(parent.code.length))
      if (Number.isFinite(suffix) && suffix > max) max = suffix
    }
  }
  const next = max + 1
  const width = next > 99 ? 3 : 2
  let code = `${parent.code}${String(next).padStart(width, '0')}`
  // تجنب أي تعارض مع رمز موجود
  while (await client.account.findUnique({ where: { code }, select: { id: true } })) {
    code = `${parent.code}${String(Number(code.slice(parent.code.length)) + 1).padStart(width, '0')}`
  }
  return code
}

export async function createChildAccount(
  tx: Tx,
  parentKeyOrId: SystemAccountKey | number,
  name: string,
  options?: { type?: AccountType; description?: string | null; isGroup?: boolean; code?: string | null },
) {
  const parent =
    typeof parentKeyOrId === 'number'
      ? await tx.account.findUnique({ where: { id: parentKeyOrId } })
      : await tx.account.findUnique({ where: { systemKey: parentKeyOrId } })
  if (!parent) throw new BusinessError('الحساب الرئيسي غير موجود')
  if (!parent.isGroup) throw new BusinessError('لا يمكن إضافة حساب فرعي تحت حساب غير تجميعي')
  let code: string
  if (options?.code) {
    // رمز يدوي: أرقام فقط، يبدأ برمز الحساب الرئيسي، وغير مستخدم
    code = options.code.trim()
    if (!/^\d+$/.test(code) || !code.startsWith(parent.code) || code.length <= parent.code.length) {
      throw new BusinessError(`الرمز يجب أن يكون أرقامًا ويبدأ برمز الحساب الرئيسي ${parent.code}`, { code: `يبدأ بـ ${parent.code}` })
    }
    if (await tx.account.findUnique({ where: { code }, select: { id: true } })) throw new BusinessError(`الرمز ${code} مستخدم`, { code: 'مستخدم' })
  } else code = await nextChildCode(tx, parent)
  return tx.account.create({
    data: {
      code,
      name: name.trim(),
      type: options?.type ?? parent.type,
      parentId: parent.id,
      isGroup: options?.isGroup ?? false,
      description: options?.description ?? null,
    },
  })
}

/** الحسابات الفرعية (القابلة للترحيل) تحت مجموعة معينة، بكل المستويات. */
export async function leafAccountsUnder(client: DbOrTx, groupKey: SystemAccountKey, options?: { activeOnly?: boolean }) {
  const group = await client.account.findUnique({ where: { systemKey: groupKey } })
  if (!group) return []
  const all = await client.account.findMany({
    where: { code: { startsWith: group.code }, isGroup: false, ...(options?.activeOnly ? { isActive: true } : {}) },
    orderBy: { code: 'asc' },
  })
  return all
}

/** تصنيفات المصروفات = الحسابات الفرعية تحت مجموعة المصروفات (5). */
export async function expenseCategories(client: DbOrTx, activeOnly = true) {
  return leafAccountsUnder(client, 'EXPENSES', { activeOnly })
}

/** تصنيفات الإيرادات الأخرى = الحسابات الفرعية تحت 42. */
export async function otherRevenueCategories(client: DbOrTx, activeOnly = true) {
  return leafAccountsUnder(client, 'OTHER_REVENUE_GROUP', { activeOnly })
}

/** حسابات الأطراف: لا تُستخدم مباشرة إلا من شاشاتها (لأن كل حركة عليها يجب أن ترتبط بطالب/مورد/مقاول/موظف). */
export const PARTY_ACCOUNT_KEYS: SystemAccountKey[] = [
  'AR_STUDENTS',
  'AP_SUPPLIERS',
  'AP_CONTRACTORS',
  'SALARIES_PAYABLE',
  'EMPLOYEE_ADVANCES',
  'CHEQUES_UNDER_COLLECTION',
]

/** هل يمكن استخدام الحساب في قيد مباشر (بدون طرف)؟ يستبعد الصناديق وحسابات الأطراف وحسابات الشركاء. */
export async function isFreePostingAccount(client: DbOrTx, accountId: number): Promise<boolean> {
  const acc = await client.account.findUnique({ where: { id: accountId }, include: { cashAccount: true } })
  if (!acc || acc.isGroup || !acc.isActive || acc.cashAccount) return false
  if (acc.systemKey && (PARTY_ACCOUNT_KEYS as string[]).includes(acc.systemKey)) return false
  const partner = await client.partner.findFirst({ where: { OR: [{ capitalAccountId: acc.id }, { drawingsAccountId: acc.id }] }, select: { id: true } })
  return !partner
}

/** الحسابات المتاحة للقيد المباشر (سند صرف «على حساب»، قيود يدوية بدون طرف). */
export async function freePostingAccounts(client: DbOrTx) {
  const partners = await client.partner.findMany({ select: { capitalAccountId: true, drawingsAccountId: true } })
  const partnerIds = partners.flatMap((p) => [p.capitalAccountId, p.drawingsAccountId]).filter((x): x is number => x !== null)
  return client.account.findMany({
    where: {
      isGroup: false,
      isActive: true,
      cashAccount: null,
      id: { notIn: partnerIds.length ? partnerIds : [-1] },
      OR: [{ systemKey: null }, { systemKey: { notIn: PARTY_ACCOUNT_KEYS } }],
    },
    orderBy: { code: 'asc' },
  })
}
