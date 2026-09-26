import { z } from 'zod'
import { isDateOnly } from '../dates'
import { parseAmountInput } from '../money'

// رسائل التحقق الافتراضية بالعربية
z.config(z.locales.ar())

/** نص اختياري: الفراغ يتحول إلى null */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `الحد الأقصى ${max} حرفًا`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

export const requiredText = (message: string, min = 1, max = 300) =>
  z.string({ error: message }).trim().min(min, message).max(max, `الحد الأقصى ${max} حرفًا`)

export const dateOnly = z
  .string({ error: 'التاريخ مطلوب' })
  .refine((v) => isDateOnly(v), 'تاريخ غير صالح')

export const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isDateOnly(v), 'تاريخ غير صالح')

export const id = z.coerce.number({ error: 'قيمة غير صالحة' }).int().positive('اختر قيمة')
export const optionalId = z
  .union([z.coerce.number().int().positive(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (typeof v === 'number' ? v : null))

/** مبلغ مالي: يقبل نصًا بأرقام عربية أو فواصل، ويعيد نصًا عشريًا نظيفًا */
export const amount = (options?: { allowZero?: boolean; message?: string }) =>
  z
    .union([z.string(), z.number()], { error: options?.message ?? 'المبلغ مطلوب' })
    .transform((v, ctx) => {
      const d = parseAmountInput(v)
      if (!d) {
        ctx.addIssue({ code: 'custom', message: options?.message ?? 'أدخل مبلغًا صحيحًا' })
        return z.NEVER
      }
      if (d.isNegative() || (!options?.allowZero && d.isZero())) {
        ctx.addIssue({ code: 'custom', message: options?.allowZero ? 'المبلغ لا يمكن أن يكون سالبًا' : 'المبلغ يجب أن يكون أكبر من صفر' })
        return z.NEVER
      }
      if (d.greaterThan('999999999999')) {
        ctx.addIssue({ code: 'custom', message: 'المبلغ كبير جدًا' })
        return z.NEVER
      }
      return d.toString()
    })

export const optionalAmount = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null
    const d = parseAmountInput(v)
    if (!d || d.isNegative()) {
      ctx.addIssue({ code: 'custom', message: 'أدخل مبلغًا صحيحًا' })
      return z.NEVER
    }
    return d.toString()
  })

export const decimalNumber = (message = 'أدخل رقمًا صحيحًا') =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const d = parseAmountInput(v === '' ? '0' : v)
    if (!d || d.isNegative()) {
      ctx.addIssue({ code: 'custom', message })
      return z.NEVER
    }
    return d.toString()
  })

export const paymentMethod = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'ELECTRONIC', 'OTHER'], {
  error: 'اختر طريقة الدفع',
})

export const cancelReason = z.string({ error: 'سبب الإلغاء مطلوب' }).trim().min(3, 'اكتب سبب الإلغاء (3 أحرف على الأقل)').max(500)

/** عدد صحيح اختياري: الفراغ يتحول إلى null */
export const optionalInt = (minValue: number, maxValue: number) =>
  z
    .union([z.literal(''), z.null(), z.coerce.number().int().min(minValue).max(maxValue)])
    .optional()
    .transform((v) => (typeof v === 'number' ? v : null))
