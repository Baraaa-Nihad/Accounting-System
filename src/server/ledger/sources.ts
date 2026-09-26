import { Prisma } from '@/generated/prisma/client'

/**
 * قيود إقفال السنة وقيود إعادة فتحها (عكس الإقفال): لا تدخل في قائمة الدخل
 * ولا في تقارير الإيرادات والمصروفات، لأنها تنقل أرصدة ولا تمثل نشاطًا.
 */
export const CLOSING_SOURCES = ['YEAR_CLOSE', 'YEAR_REOPEN'] as const

/** شرط SQL على جدول القيود (بالاسم المستعار je). */
export const NOT_CLOSING_SQL = Prisma.sql`je."sourceType" NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')`
