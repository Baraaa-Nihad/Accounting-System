'use server'

import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, BusinessError, type ActionResult } from '@/server/errors'
import { getSettings, saveSetting, settingsSchemas, type SettingsKey } from '@/server/settings'
import { audit } from '@/server/audit'
import { addSection, createAcademicYear, removeSection, saveGrade, saveStage, setCurrentYear, updateAcademicYearDates } from '@/server/services/school'
import { saveCategoryAccount, saveChargeType, saveDiscountType } from '@/server/services/categories'
import { ensureDir, storageRoot } from '@/server/storage'
import { detectFileType } from '@/server/services/attachments'
import { cancelReason, dateOnly, optionalAmount, optionalText, requiredText } from '@/lib/schemas/common'
import { closeYear, reopenYear } from '@/server/services/year-closing'
import { ADMIN_ROLE_KEY } from '@/lib/permissions'

const EDITABLE: SettingsKey[] = ['school', 'finance', 'numbering', 'print', 'payroll', 'security', 'backup']

export async function saveSettingsAction(key: SettingsKey, value: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext(key === 'backup' ? 'backup.manage' : 'settings.manage')
    if (!EDITABLE.includes(key)) throw new BusinessError('إعداد غير معروف')
    const before = (await getSettings())[key]
    const parsed = settingsSchemas[key].parse({ ...(before as object), ...(value as object) })
    await transaction(async (tx) => {
      await saveSetting(tx, key, parsed as never)
      await audit(tx, ctx, { action: 'settings', entityType: 'Setting', entityId: key, entityLabel: key, summary: `تعديل الإعدادات (${key})`, before, after: parsed })
    })
    return ok(null, 'تم حفظ الإعدادات')
  } catch (e) {
    return toActionError(e)
  }
}

export async function uploadLogoAction(formData: FormData): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('settings.manage')
    const file = formData.get('file')
    if (!(file instanceof File)) throw new BusinessError('اختر صورة الشعار')
    if (file.size > 2 * 1024 * 1024) throw new BusinessError('حجم الشعار يجب ألا يتجاوز 2 ميغابايت')
    const buf = Buffer.from(await file.arrayBuffer())
    const type = detectFileType(buf)
    if (!type || !type.mime.startsWith('image/')) throw new BusinessError('الشعار يجب أن يكون صورة PNG أو JPG أو WEBP')
    const dir = await ensureDir(path.join(storageRoot(), 'branding'))
    const name = `logo-${Date.now()}.${type.ext}`
    await writeFile(path.join(dir, name), buf)
    const school = (await getSettings()).school
    await transaction(async (tx) => {
      await saveSetting(tx, 'school', { ...school, logo: name })
      await audit(tx, ctx, { action: 'settings', entityType: 'Setting', entityId: 'school', summary: 'تحديث شعار المدرسة' })
    })
    return ok(null, 'تم تحديث الشعار')
  } catch (e) {
    return toActionError(e)
  }
}

// ---- السنوات الدراسية ----
const yearSchema = z.object({ name: requiredText('اسم السنة مطلوب'), startDate: dateOnly, endDate: dateOnly, makeCurrent: z.boolean().optional() })

export async function createYearAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('years.manage')
    const data = yearSchema.parse(input)
    await transaction((tx) => createAcademicYear(tx, ctx, data))
    return ok(null, 'تم إنشاء السنة الدراسية')
  } catch (e) {
    return toActionError(e)
  }
}

export async function setCurrentYearAction(yearId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('years.manage')
    await transaction((tx) => setCurrentYear(tx, ctx, yearId))
    return ok(null, 'تم تعيين السنة الحالية')
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateYearDatesAction(yearId: number, input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('years.manage')
    const data = z.object({ startDate: dateOnly, endDate: dateOnly }).parse(input)
    await transaction((tx) => updateAcademicYearDates(tx, ctx, yearId, data))
    return ok(null, 'تم حفظ التواريخ')
  } catch (e) {
    return toActionError(e)
  }
}

// ---- الصفوف والشعب ----
export async function saveGradeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('settings.manage')
    const data = z
      .object({
        id: z.number().int().positive().optional().nullable(),
        name: requiredText('اسم الصف مطلوب'),
        stageId: z.coerce.number().int().positive().optional().nullable(),
        sortOrder: z.coerce.number().int().optional(),
        nextGradeId: z.coerce.number().int().positive().optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .parse(input)
    await transaction((tx) => saveGrade(tx, ctx, data))
    return ok(null, 'تم حفظ الصف')
  } catch (e) {
    return toActionError(e)
  }
}

export async function saveStageAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('settings.manage')
    const data = z.object({ id: z.number().int().positive().optional().nullable(), name: requiredText('اسم المرحلة مطلوب'), sortOrder: z.coerce.number().int().optional() }).parse(input)
    await transaction((tx) => saveStage(tx, ctx, data))
    return ok(null, 'تم حفظ المرحلة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function addSectionAction(gradeId: number, name: string): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('settings.manage')
    await transaction((tx) => addSection(tx, ctx, gradeId, name))
    return ok(null, 'تمت إضافة الشعبة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function removeSectionAction(sectionId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('settings.manage')
    await transaction((tx) => removeSection(tx, ctx, sectionId))
    return ok(null, 'تم حذف الشعبة')
  } catch (e) {
    return toActionError(e)
  }
}

// ---- التصنيفات ----
export async function saveChargeTypeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('revenues.manage')
    const data = z
      .object({
        id: z.number().int().positive().optional().nullable(),
        name: requiredText('اسم التصنيف مطلوب'),
        defaultAmount: optionalAmount,
        allowInstallments: z.boolean(),
        isActive: z.boolean(),
        description: optionalText(300),
      })
      .parse(input)
    await transaction((tx) => saveChargeType(tx, ctx, data))
    return ok(null, 'تم حفظ تصنيف الذمة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function saveDiscountTypeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('revenues.manage')
    const data = z
      .object({
        id: z.number().int().positive().optional().nullable(),
        name: requiredText('اسم نوع الخصم مطلوب'),
        defaultMethod: z.union([z.enum(['PERCENT', 'FIXED']), z.literal(''), z.null()]).transform((v) => (v ? v : null)),
        defaultValue: optionalAmount,
        isActive: z.boolean(),
        description: optionalText(300),
      })
      .parse(input)
    await transaction((tx) => saveDiscountType(tx, ctx, data))
    return ok(null, 'تم حفظ نوع الخصم')
  } catch (e) {
    return toActionError(e)
  }
}

export async function saveCategoryAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const data = z
      .object({
        id: z.number().int().positive().optional().nullable(),
        kind: z.enum(['EXPENSE', 'OTHER_REVENUE']),
        name: requiredText('اسم التصنيف مطلوب'),
        isActive: z.boolean(),
        description: optionalText(300),
      })
      .parse(input)
    const ctx = await actionContext(data.kind === 'EXPENSE' ? 'expenses.manage' : 'revenues.manage')
    await transaction((tx) => saveCategoryAccount(tx, ctx, data))
    return ok(null, 'تم حفظ التصنيف')
  } catch (e) {
    return toActionError(e)
  }
}

// ---- إغلاق السنة وإعادة فتحها ----
const closeYearSchema = z.object({ yearId: z.coerce.number().int().positive(), distribute: z.boolean(), makeNextCurrent: z.boolean() })

export async function closeYearAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('years.manage')
    const data = closeYearSchema.parse(input)
    const res = await transaction((tx) => closeYear(tx, ctx, data.yearId, { distribute: data.distribute, makeNextCurrent: data.makeNextCurrent }), { timeout: 120_000 })
    return ok(null, `تم إغلاق السنة${res.closingEntry ? ` بقيد الإقفال ${res.closingEntry.number}` : ''}`)
  } catch (e) {
    return toActionError(e)
  }
}

const reopenYearSchema = z.object({ yearId: z.coerce.number().int().positive(), reason: cancelReason })

/** إعادة فتح سنة مغلقة: لمدير النظام فقط (docs/05-workflows.md §5.23). */
export async function reopenYearAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('years.manage')
    if (ctx.user.roleKey !== ADMIN_ROLE_KEY) throw new BusinessError('إعادة فتح سنة مغلقة متاحة لمدير النظام فقط')
    const data = reopenYearSchema.parse(input)
    const res = await transaction((tx) => reopenYear(tx, ctx, data.yearId, data.reason), { timeout: 120_000 })
    return ok(null, `تمت إعادة فتح السنة${res.reversed.length ? ` وعكس ${res.reversed.length} قيد إقفال` : ''}`)
  } catch (e) {
    return toActionError(e)
  }
}
