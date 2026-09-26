'use server'

import { transaction } from '@/server/db'
import { actionContext, assertCan } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { changeStudentStatus, createStudent, refreshStudentSearchText, updateStudent } from '@/server/services/students'
import { audit } from '@/server/audit'
import { updateGuardian } from '@/server/services/guardians'
import { applyFeePlansToStudent } from '@/server/services/charges'
import { guardianSchema, studentSchema, studentStatusSchema } from '@/lib/schemas/students'
import { z } from 'zod'

export async function createStudentAction(input: unknown): Promise<ActionResult<{ id: number; charges: number }>> {
  try {
    const ctx = await actionContext('students.create')
    const data = studentSchema.parse(input)
    if (data.applyFeePlans) assertCan(ctx, 'charges.create', 'لا تملك صلاحية إضافة الذمم (الرسوم المقررة)')
    const result = await transaction(async (tx) => {
      const student = await createStudent(tx, ctx, data)
      const fees = data.applyFeePlans ? await applyFeePlansToStudent(tx, ctx, student.id, data.academicYearId) : { created: 0 }
      return { id: student.id, charges: fees.created }
    })
    return ok(result, result.charges ? `تم حفظ الطالب وإضافة ${result.charges} من الرسوم المقررة` : 'تم حفظ الطالب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateStudentAction(studentId: number, input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('students.edit')
    const data = studentSchema.parse(input)
    await transaction((tx) => updateStudent(tx, ctx, studentId, data))
    return ok({ id: studentId }, 'تم حفظ التعديلات')
  } catch (e) {
    return toActionError(e)
  }
}

export async function changeStudentStatusAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('students.edit')
    const data = studentStatusSchema.parse(input)
    if (data.cancelFutureInstallments) assertCan(ctx, 'charges.cancel', 'إلغاء الأقساط يتطلب صلاحية إلغاء الذمم')
    await transaction((tx) => changeStudentStatus(tx, ctx, data))
    return ok(null, 'تم تغيير حالة الطالب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateGuardianAction(guardianId: number, input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('families.manage', 'students.edit')
    const data = guardianSchema.parse(input)
    await transaction((tx) => updateGuardian(tx, ctx, guardianId, data))
    return ok(null, 'تم حفظ بيانات ولي الأمر')
  } catch (e) {
    return toActionError(e)
  }
}

export async function moveStudentToFamilyAction(studentId: number, guardianId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('families.manage')
    z.number().int().positive().parse(guardianId)
    await transaction(async (tx) => {
      const before = await tx.student.findUniqueOrThrow({ where: { id: studentId } })
      const g = await tx.guardian.findUniqueOrThrow({ where: { id: guardianId } })
      await tx.student.update({ where: { id: studentId }, data: { guardianId } })
      await refreshStudentSearchText(tx, studentId)
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'Student',
        entityId: studentId,
        entityLabel: before.fullName,
        summary: `ربط الطالب ${before.fullName} بعائلة ${g.name}`,
        before: { guardianId: before.guardianId },
        after: { guardianId },
      })
    })
    return ok(null, 'تم ربط الطالب بالعائلة')
  } catch (e) {
    return toActionError(e)
  }
}
