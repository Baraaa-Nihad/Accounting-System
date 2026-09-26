import 'server-only'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { buildSearchText, cleanPhone } from '@/lib/arabic'
import type { GuardianInput } from '@/lib/schemas/students'

export function guardianSearchText(g: { name: string; phone?: string | null; phone2?: string | null; nationalId?: string | null }) {
  return buildSearchText([g.name, g.phone, g.phone2, g.nationalId])
}

/** ولي أمر بنفس رقم الهاتف (مقارنة آخر 9 أرقام لتجاهل رمز الدولة والصفر). */
export async function findGuardianByPhone(client: DbOrTx, phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 7) return null
  const tail = digits.slice(-9)
  return client.guardian.findFirst({
    where: { OR: [{ phone: { endsWith: tail } }, { phone2: { endsWith: tail } }] },
    include: {
      students: {
        select: { id: true, fullName: true, studentNumber: true, status: true },
        orderBy: { fullName: 'asc' },
      },
    },
  })
}

export async function createGuardian(tx: Tx, ctx: Ctx, input: GuardianInput) {
  const data = {
    name: input.name,
    phone: cleanPhone(input.phone),
    phone2: cleanPhone(input.phone2),
    relation: input.relation,
    nationalId: input.nationalId,
    email: input.email,
    address: input.address,
    notes: input.notes,
  }
  const guardian = await tx.guardian.create({ data: { ...data, searchText: guardianSearchText(data) } })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'Guardian',
    entityId: guardian.id,
    entityLabel: guardian.name,
    summary: `إضافة ولي أمر: ${guardian.name}`,
    after: guardian,
  })
  return guardian
}

export async function updateGuardian(tx: Tx, ctx: Ctx, guardianId: number, input: GuardianInput) {
  const before = await tx.guardian.findUnique({ where: { id: guardianId } })
  if (!before) throw new BusinessError('ولي الأمر غير موجود')
  const data = {
    name: input.name,
    phone: cleanPhone(input.phone),
    phone2: cleanPhone(input.phone2),
    relation: input.relation,
    nationalId: input.nationalId,
    email: input.email,
    address: input.address,
    notes: input.notes,
  }
  const after = await tx.guardian.update({ where: { id: guardianId }, data: { ...data, searchText: guardianSearchText(data) } })
  // تحديث نص البحث لكل الأبناء (يتضمن اسم وهاتف ولي الأمر)
  const { refreshStudentSearchText } = await import('./students')
  const children = await tx.student.findMany({ where: { guardianId }, select: { id: true } })
  for (const c of children) await refreshStudentSearchText(tx, c.id)
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'Guardian',
    entityId: guardianId,
    entityLabel: after.name,
    summary: `تعديل بيانات ولي الأمر: ${after.name}`,
    before,
    after,
  })
  return after
}
