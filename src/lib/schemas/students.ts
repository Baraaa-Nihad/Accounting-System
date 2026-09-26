import { z } from 'zod'
import { id, optionalDate, optionalId, optionalText, requiredText } from './common'

export const guardianSchema = z.object({
  name: requiredText('اسم ولي الأمر مطلوب', 2, 150),
  phone: requiredText('رقم هاتف ولي الأمر مطلوب', 6, 30),
  phone2: optionalText(30),
  relation: optionalText(40),
  nationalId: optionalText(40),
  email: optionalText(120),
  address: optionalText(300),
  notes: optionalText(1000),
})
export type GuardianInput = z.infer<typeof guardianSchema>

export const studentSchema = z.object({
  fullName: requiredText('اسم الطالب مطلوب', 3, 200),
  schoolNumber: optionalText(50),
  gender: z
    .union([z.enum(['MALE', 'FEMALE']), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v ? v : null)),
  birthDate: optionalDate,
  nationalId: optionalText(40),
  joinDate: optionalDate,
  address: optionalText(300),
  notes: optionalText(2000),
  guardianId: optionalId,
  guardian: guardianSchema.optional().nullable(),
  academicYearId: id,
  gradeId: id,
  sectionId: optionalId,
  applyFeePlans: z.boolean().optional(),
  confirmDuplicate: z.boolean().optional(),
})
export type StudentInput = z.input<typeof studentSchema>

export const studentStatusSchema = z.object({
  studentId: id,
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'SUSPENDED']),
  reason: optionalText(500),
  date: optionalDate,
  cancelFutureInstallments: z.boolean().optional(),
})
