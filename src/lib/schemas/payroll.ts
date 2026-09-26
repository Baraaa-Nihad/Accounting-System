import { z } from 'zod'
import { amount, cancelReason, dateOnly, decimalNumber, id, optionalAmount, optionalDate, optionalInt, optionalText, paymentMethod, requiredText } from './common'

export const employeeSchema = z.object({
  fullName: requiredText('اسم الموظف مطلوب', 3, 150),
  phone: optionalText(30),
  jobTitle: optionalText(100),
  department: optionalText(100),
  isTeacher: z.boolean().optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional().nullable().or(z.literal('').transform(() => null)),
  nationalId: optionalText(30),
  hireDate: optionalDate,
  salaryType: z.enum(['MONTHLY', 'DAILY', 'HOURLY'], { error: 'اختر نوع الراتب' }),
  baseSalary: amount({ allowZero: true, message: 'أدخل الراتب' }),
  overtimeRate: optionalAmount,
  bankName: optionalText(120),
  bankAccount: optionalText(60),
  iban: optionalText(60),
  address: optionalText(300),
  notes: optionalText(1000),
})

export const employeeStatusSchema = z.object({
  id,
  status: z.enum(['ACTIVE', 'INACTIVE']),
  endDate: optionalDate,
  reason: optionalText(300),
})

export const createRunSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1, 'اختر الشهر').max(12),
  postingDate: optionalDate,
  notes: optionalText(500),
})

export const payrollItemSchema = z.object({
  id,
  workDays: decimalNumber(),
  workHours: decimalNumber(),
  absenceDays: decimalNumber(),
  lateHours: decimalNumber(),
  bonuses: decimalNumber(),
  allowances: decimalNumber(),
  otherDeductions: decimalNumber(),
  withholdings: decimalNumber(),
  notes: optionalText(300),
})

export const runReasonSchema = z.object({ id, reason: cancelReason })

export const payRunSchema = z.object({
  runId: id,
  itemIds: z.array(id).optional().nullable(),
  date: dateOnly,
  cashAccountId: id,
  paymentMethod,
  referenceNumber: optionalText(80),
})

export const overtimeSchema = z.object({
  employeeId: id,
  date: dateOnly,
  hours: amount({ message: 'أدخل عدد الساعات' }),
  rate: optionalAmount,
  reason: optionalText(300),
  notes: optionalText(500),
})

export const advanceSchema = z.object({
  employeeId: id,
  date: dateOnly,
  amount: amount({ message: 'أدخل مبلغ السلفة' }),
  installmentsCount: z.coerce.number({ error: 'أدخل عدد الأقساط' }).int().min(1, 'قسط واحد على الأقل').max(60),
  monthlyDeduction: optionalAmount,
  startYear: optionalInt(2000, 2200),
  startMonth: optionalInt(1, 12),
  reason: optionalText(300),
  notes: optionalText(500),
  cashAccountId: id,
  paymentMethod,
  cheque: z.object({ number: requiredText('رقم الشيك مطلوب', 1, 50), bankName: optionalText(120), dueDate: dateOnly }).optional().nullable(),
  referenceNumber: optionalText(80),
})

export const advanceScheduleSchema = z.object({
  id,
  monthlyDeduction: amount({ message: 'أدخل القسط الشهري' }),
  startYear: z.coerce.number().int().min(2000).max(2200),
  startMonth: z.coerce.number().int().min(1).max(12),
  reason: requiredText('اكتب سبب التعديل', 3, 300),
})
