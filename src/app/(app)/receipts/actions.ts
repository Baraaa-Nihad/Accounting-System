'use server'

import { db, transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import {
  applyStudentCredit,
  bounceCheque,
  cancelReceipt,
  clearCheque,
  createOpeningCredit,
  createOtherReceipt,
  createStudentReceipt,
  openInstallments,
  reallocateReceipt,
  studentCredit,
  type OpenInstallment,
} from '@/server/services/receipts'
import { boxOptionsFor } from '@/server/services/treasury'
import {
  applyCreditSchema,
  bounceChequeSchema,
  cancelReceiptSchema,
  clearChequeSchema,
  openingCreditSchema,
  otherReceiptSchema,
  reallocateSchema,
  studentReceiptSchema,
} from '@/lib/schemas/receipts'

export interface PaymentContext {
  students: { id: number; fullName: string; studentNumber: string; credit: string }[]
  installments: OpenInstallment[]
  payerName: string
  cashAccounts: { id: number; name: string; type: 'CASHBOX' | 'BANK'; isDefault: boolean }[]
}

/** بيانات نافذة تسجيل الدفعة: الأقساط المفتوحة والصناديق والرصيد الدائن. */
export async function loadPaymentContextAction(input: { studentId?: number; guardianId?: number }): Promise<ActionResult<PaymentContext>> {
  try {
    const ctx = await actionContext('receipts.create')
    let students: { id: number; fullName: string; studentNumber: string }[] = []
    let payerName = ''
    if (input.guardianId) {
      const g = await db.guardian.findUniqueOrThrow({ where: { id: input.guardianId }, include: { students: { orderBy: { id: 'asc' } } } })
      students = g.students
      payerName = g.name
    } else if (input.studentId) {
      const s = await db.student.findUniqueOrThrow({ where: { id: input.studentId }, include: { guardian: true } })
      students = [s]
      payerName = s.guardian?.name ?? s.fullName
    }
    const [installments, cashAccounts, credits] = await Promise.all([
      openInstallments(db, students.map((s) => s.id)),
      boxOptionsFor(db, ctx.userId, ctx.permissions),
      Promise.all(students.map((s) => studentCredit(db, s.id))),
    ])
    return ok({
      students: students.map((s, i) => ({ id: s.id, fullName: s.fullName, studentNumber: s.studentNumber, credit: credits[i].toString() })),
      installments,
      payerName,
      cashAccounts: cashAccounts.map((c) => ({ id: c.id, name: c.name, type: c.type, isDefault: c.isDefault })),
    })
  } catch (e) {
    return toActionError(e)
  }
}

export async function createStudentReceiptAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('receipts.create')
    const data = studentReceiptSchema.parse(input)
    const r = await transaction((tx) =>
      createStudentReceipt(tx, ctx, {
        ...data,
        allocations: data.allocations?.filter((a) => Number(a.amount) > 0) ?? null,
      }),
    )
    return ok({ id: r.id, number: r.number }, `تم حفظ سند القبض ${r.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function createOtherReceiptAction(input: unknown): Promise<ActionResult<{ id: number; number: string }>> {
  try {
    const ctx = await actionContext('receipts.create')
    const data = otherReceiptSchema.parse(input)
    const r = await transaction((tx) => createOtherReceipt(tx, ctx, data))
    return ok({ id: r.id, number: r.number }, `تم حفظ سند القبض ${r.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelReceiptAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('receipts.cancel')
    const { id, reason } = cancelReceiptSchema.parse(input)
    await transaction((tx) => cancelReceipt(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء السند')
  } catch (e) {
    return toActionError(e)
  }
}

export async function clearChequeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('cheques.manage')
    const data = clearChequeSchema.parse(input)
    await transaction((tx) => clearCheque(tx, ctx, data.chequeId, data))
    return ok(null, 'تم تحصيل الشيك')
  } catch (e) {
    return toActionError(e)
  }
}

export async function bounceChequeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('cheques.manage')
    const data = bounceChequeSchema.parse(input)
    await transaction((tx) => bounceCheque(tx, ctx, data.chequeId, data.reason))
    return ok(null, 'تم تسجيل الشيك مرتجعًا وإعادة المبلغ على الطالب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function applyCreditAction(input: unknown): Promise<ActionResult<{ applied: string }>> {
  try {
    const ctx = await actionContext('receipts.edit', 'receipts.create')
    const data = applyCreditSchema.parse(input)
    const res = await transaction((tx) => applyStudentCredit(tx, ctx, data.studentId, data.allocations))
    return ok(res, 'تم تطبيق الرصيد الدائن على الذمم')
  } catch (e) {
    return toActionError(e)
  }
}

export async function reallocateReceiptAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('receipts.edit')
    const data = reallocateSchema.parse(input)
    await transaction((tx) => reallocateReceipt(tx, ctx, data.receiptId, data.allocations))
    return ok(null, 'تمت إعادة توزيع الدفعة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function createOpeningCreditAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('receipts.create')
    const data = openingCreditSchema.parse(input)
    const r = await transaction((tx) => createOpeningCredit(tx, ctx, data))
    return ok({ id: r.id }, 'تم تسجيل الرصيد الدائن الافتتاحي')
  } catch (e) {
    return toActionError(e)
  }
}
