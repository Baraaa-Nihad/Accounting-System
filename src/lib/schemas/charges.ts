import { z } from 'zod'
import { amount, cancelReason, dateOnly, id, optionalDate, optionalId, optionalText, requiredText } from './common'

export const discountSpecSchema = z.object({
  method: z.enum(['PERCENT', 'FIXED']),
  value: amount({ message: 'أدخل قيمة الخصم' }),
  discountTypeId: optionalId,
  reason: requiredText('سبب الخصم مطلوب', 2, 500),
  approvedBy: optionalText(120),
})

export const scheduleLineSchema = z.object({ dueDate: dateOnly, amount: amount({ allowZero: true }) })

export const installmentsSchema = z.object({
  count: z.coerce.number().int().min(1, 'عدد الأقساط 1 على الأقل').max(60, 'الحد الأقصى 60 قسطًا'),
  firstDueDate: dateOnly,
  dueDay: z
    .union([z.coerce.number().int().min(1).max(31), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  schedule: z.array(scheduleLineSchema).optional().nullable(),
})

export const createChargeSchema = z.object({
  studentId: id,
  chargeTypeId: id,
  academicYearId: id,
  date: dateOnly,
  dueDate: optionalDate,
  grossAmount: amount({ message: 'أدخل قيمة الذمة' }),
  description: optionalText(300),
  notes: optionalText(1000),
  discount: discountSpecSchema.optional().nullable(),
  installments: installmentsSchema.optional().nullable(),
  applyRules: z.boolean().optional(),
})

export const addDiscountSchema = z.object({
  studentId: id,
  scope: z.enum(['CHARGE', 'CHARGE_TYPE', 'ACCOUNT']),
  chargeId: optionalId,
  chargeTypeId: optionalId,
  academicYearId: id,
  method: z.enum(['PERCENT', 'FIXED']),
  value: amount({ message: 'أدخل قيمة الخصم' }),
  discountTypeId: optionalId,
  reason: requiredText('سبب الخصم مطلوب', 2, 500),
  approvedBy: optionalText(120),
  date: dateOnly,
  distribution: z.enum(['EVEN', 'FROM_LAST']),
  makeRule: z.boolean().optional(),
})

export const rescheduleSchema = z.object({
  chargeId: id,
  count: z.coerce.number().int().min(1).max(60),
  firstDueDate: dateOnly,
  dueDay: z
    .union([z.coerce.number().int().min(1).max(31), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  schedule: z.array(scheduleLineSchema).optional().nullable(),
})

export const bulkChargeSchema = z.object({
  academicYearId: id,
  chargeTypeId: id,
  gradeIds: z.array(z.coerce.number().int().positive()).default([]),
  studentIds: z.array(z.coerce.number().int().positive()).optional().nullable(),
  useFeePlan: z.boolean(),
  amount: z.string().optional().nullable(),
  date: dateOnly,
  dueDate: optionalDate,
  installments: z
    .object({
      count: z.coerce.number().int().min(1).max(60),
      firstDueDate: dateOnly,
      dueDay: z
        .union([z.coerce.number().int().min(1).max(31), z.literal(''), z.null(), z.undefined()])
        .transform((v) => (typeof v === 'number' ? v : null)),
    })
    .optional()
    .nullable(),
  description: optionalText(300),
  applyRules: z.boolean(),
  includeInactive: z.boolean().optional(),
})

export const feePlanSchema = z.object({
  academicYearId: id,
  gradeId: id,
  chargeTypeId: id,
  amount: amount({ message: 'أدخل المبلغ' }),
  installmentsCount: z.coerce.number().int().min(1).max(60),
  firstDueDate: optionalDate,
  dueDay: z
    .union([z.coerce.number().int().min(1).max(31), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (typeof v === 'number' ? v : null)),
  notes: optionalText(300),
})

export const cancelSchema = z.object({ id, reason: cancelReason })
