import { z } from 'zod'
import { amount, dateOnly, id, optionalDate, optionalId, optionalText, paymentMethod, requiredText, cancelReason } from './common'

export const allocationSchema = z.object({ installmentId: id, amount: amount({ allowZero: true }) })

export const chequeSchema = z.object({
  number: requiredText('رقم الشيك مطلوب', 1, 50),
  bankName: optionalText(120),
  dueDate: dateOnly,
  drawerName: optionalText(150),
  depositToAccountId: optionalId,
})

export const studentReceiptSchema = z.object({
  kind: z.enum(['STUDENT', 'FAMILY']),
  studentId: optionalId,
  guardianId: optionalId,
  date: dateOnly,
  amount: amount({ message: 'أدخل المبلغ المدفوع' }),
  paymentMethod,
  cashAccountId: optionalId,
  cheque: chequeSchema.optional().nullable(),
  payerName: optionalText(150),
  referenceNumber: optionalText(80),
  description: optionalText(300),
  notes: optionalText(1000),
  allocations: z.array(allocationSchema).optional().nullable(),
  creditStudentId: optionalId,
  confirmCredit: z.boolean().optional(),
})

export const otherReceiptSchema = z.object({
  kind: z.enum(['OTHER_REVENUE', 'PARTNER_CAPITAL']),
  date: dateOnly,
  amount: amount({ message: 'أدخل المبلغ' }),
  paymentMethod,
  cashAccountId: optionalId,
  cheque: chequeSchema.optional().nullable(),
  revenueAccountId: optionalId,
  partnerId: optionalId,
  payerName: requiredText('اسم الدافع مطلوب', 2, 150),
  referenceNumber: optionalText(80),
  description: optionalText(300),
  notes: optionalText(1000),
})

export const cancelReceiptSchema = z.object({ id, reason: cancelReason })
export const clearChequeSchema = z.object({ chequeId: id, bankAccountId: id, date: dateOnly })
export const bounceChequeSchema = z.object({ chequeId: id, reason: cancelReason })
export const applyCreditSchema = z.object({ studentId: id, allocations: z.array(allocationSchema).optional().nullable() })
export const reallocateSchema = z.object({ receiptId: id, allocations: z.array(allocationSchema) })
export const openingCreditSchema = z.object({ studentId: id, date: dateOnly, amount: amount(), notes: optionalText(500) })
export { optionalDate }
