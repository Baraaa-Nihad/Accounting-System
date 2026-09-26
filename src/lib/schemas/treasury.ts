import { z } from 'zod'
import { amount, cancelReason, dateOnly, id, optionalAmount, optionalDate, optionalId, optionalText, paymentMethod, requiredText } from './common'

// ---------------------------------------------------------------------
// الصناديق والبنوك والتحويلات
// ---------------------------------------------------------------------

export const cashAccountSchema = z.object({
  name: requiredText('اسم الصندوق/الحساب مطلوب', 2, 120),
  type: z.enum(['CASHBOX', 'BANK'], { error: 'اختر النوع' }),
  bankName: optionalText(120),
  accountNumber: optionalText(60),
  iban: optionalText(60),
  openingBalance: optionalAmount,
  openingDate: optionalDate,
  lowBalanceAlert: optionalAmount,
  isDefault: z.boolean().optional(),
  notes: optionalText(500),
})

export const updateCashAccountSchema = z.object({
  id,
  name: requiredText('اسم الصندوق/الحساب مطلوب', 2, 120),
  bankName: optionalText(120),
  accountNumber: optionalText(60),
  iban: optionalText(60),
  lowBalanceAlert: optionalAmount,
  isDefault: z.boolean().optional(),
  isActive: z.boolean(),
  notes: optionalText(500),
})

export const transferSchema = z.object({
  date: dateOnly,
  fromAccountId: id,
  toAccountId: id,
  amount: amount({ message: 'أدخل المبلغ' }),
  description: optionalText(300),
  notes: optionalText(500),
})

export const cancelDocSchema = z.object({ id, reason: cancelReason })

// ---------------------------------------------------------------------
// سندات الصرف
// ---------------------------------------------------------------------

export const VOUCHER_KINDS = ['EXPENSE', 'SUPPLIER_PAYMENT', 'CONTRACTOR_PAYMENT', 'SALARY', 'ADVANCE', 'STUDENT_REFUND', 'PARTNER_WITHDRAWAL', 'OTHER'] as const

export const voucherSchema = z.object({
  kind: z.enum(VOUCHER_KINDS, { error: 'اختر نوع الصرف' }),
  date: dateOnly,
  amount: amount({ message: 'أدخل المبلغ' }),
  paymentMethod,
  cashAccountId: id,
  payeeName: optionalText(150),
  expenseAccountId: optionalId,
  supplierId: optionalId,
  contractorJobId: optionalId,
  payrollItemId: optionalId,
  advanceId: optionalId,
  studentId: optionalId,
  partnerId: optionalId,
  otherAccountId: optionalId,
  cheque: z
    .object({ number: requiredText('رقم الشيك مطلوب', 1, 50), bankName: optionalText(120), dueDate: dateOnly })
    .optional()
    .nullable(),
  referenceNumber: optionalText(80),
  description: optionalText(300),
  notes: optionalText(1000),
  allowSupplierAdvance: z.boolean().optional(),
})

// ---------------------------------------------------------------------
// الموردون والمقاولون
// ---------------------------------------------------------------------

export const supplierSchema = z.object({
  id: optionalId,
  name: requiredText('اسم المورد مطلوب', 2, 150),
  category: optionalText(80),
  phone: optionalText(30),
  email: optionalText(120),
  contactPerson: optionalText(120),
  address: optionalText(300),
  taxNumber: optionalText(60),
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
})

export const billSchema = z.object({
  supplierId: id,
  date: dateOnly,
  dueDate: optionalDate,
  expenseAccountId: optionalId,
  amount: amount({ message: 'أدخل مبلغ الفاتورة' }),
  supplierInvoiceNo: optionalText(60),
  description: optionalText(300),
  notes: optionalText(1000),
  isOpening: z.boolean().optional(),
})

export const contractorSchema = z.object({
  id: optionalId,
  name: requiredText('الاسم مطلوب', 2, 150),
  specialty: optionalText(80),
  phone: optionalText(30),
  nationalId: optionalText(30),
  notes: optionalText(1000),
  isActive: z.boolean().optional(),
})

export const jobSchema = z.object({
  contractorId: id,
  description: requiredText('وصف العمل مطلوب', 2, 300),
  agreedAmount: amount({ message: 'أدخل قيمة الاتفاق' }),
  startDate: dateOnly,
  endDate: optionalDate,
  expenseAccountId: id,
  notes: optionalText(1000),
})

export const adjustJobSchema = z.object({
  id,
  newAmount: amount({ message: 'أدخل القيمة الجديدة' }),
  reason: requiredText('اكتب سبب التعديل', 3, 300),
  date: dateOnly,
})

export const jobStatusSchema = z.object({
  id,
  status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
  reason: optionalText(300),
})
