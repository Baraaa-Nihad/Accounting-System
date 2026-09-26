import { z } from 'zod'
import { isPermission } from '../permissions'
import { dateOnly, optionalDate, optionalText, requiredText } from './common'

const permissionList = z
  .array(z.string())
  .default([])
  .transform((list) => [...new Set(list.filter(isPermission))])

export const userBaseSchema = z.object({
  fullName: requiredText('الاسم الكامل مطلوب', 2, 120),
  email: optionalText(120).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'بريد إلكتروني غير صالح'),
  phone: optionalText(30),
  roleId: z.coerce.number({ error: 'اختر الدور' }).int().positive('اختر الدور'),
  extraPermissions: permissionList,
  revokedPermissions: permissionList,
})

export const createUserSchema = userBaseSchema.extend({
  username: z
    .string({ error: 'اسم المستخدم مطلوب' })
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'اسم المستخدم: 3–40 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو (. _ -) بدون مسافات'),
  password: z.string({ error: 'كلمة المرور المؤقتة مطلوبة' }).min(1, 'كلمة المرور المؤقتة مطلوبة'),
})

export const updateUserSchema = userBaseSchema.extend({
  id: z.coerce.number().int().positive(),
  isActive: z.boolean(),
})

export const resetPasswordSchema = z.object({
  id: z.coerce.number().int().positive(),
  password: z.string({ error: 'كلمة المرور مطلوبة' }).min(1, 'كلمة المرور مطلوبة'),
})

export const roleSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  name: requiredText('اسم الدور مطلوب', 2, 60),
  description: optionalText(300),
  permissions: permissionList,
})

export const partnerSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  name: requiredText('اسم الشريك مطلوب', 2, 120),
  phone: optionalText(30),
  email: optionalText(120),
  ownershipPercent: z.coerce.number({ error: 'نسبة الملكية مطلوبة' }).min(0, 'النسبة بين 0 و 100').max(100, 'النسبة بين 0 و 100'),
  userId: z
    .union([z.coerce.number().int().positive(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (typeof v === 'number' ? v : null)),
  joinDate: optionalDate,
  notes: optionalText(500),
  isActive: z.boolean().default(true),
})

export const partnerDateSchema = dateOnly
