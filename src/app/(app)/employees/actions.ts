'use server'

import { db, transaction } from '@/server/db'
import { actionContext } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import { createEmployee, setEmployeeStatus, updateEmployee } from '@/server/services/employees'
import { employeeSchema, employeeStatusSchema } from '@/lib/schemas/payroll'
import { id as idSchema } from '@/lib/schemas/common'

export async function createEmployeeAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('employees.manage')
    const data = employeeSchema.parse(input)
    const e = await transaction((tx) => createEmployee(tx, ctx, data))
    return ok({ id: e.id }, `تمت إضافة ${e.fullName} (${e.employeeNumber})`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateEmployeeAction(input: { id: unknown; data: unknown }): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('employees.manage')
    const id = idSchema.parse(input.id)
    const data = employeeSchema.parse(input.data)
    // تعديل الراتب يتطلب صلاحية الاطلاع على الرواتب
    if (!ctx.permissions.has('salaries.view') && !ctx.permissions.has('payroll.manage')) {
      const current = await db.employee.findUniqueOrThrow({ where: { id } })
      data.baseSalary = current.baseSalary.toString()
      data.salaryType = current.salaryType
      data.overtimeRate = current.overtimeRate?.toString() ?? null
    }
    const e = await transaction((tx) => updateEmployee(tx, ctx, id, data))
    return ok({ id: e.id }, 'تم حفظ بيانات الموظف')
  } catch (e) {
    return toActionError(e)
  }
}

export async function setEmployeeStatusAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('employees.manage')
    const { id, ...data } = employeeStatusSchema.parse(input)
    await transaction((tx) => setEmployeeStatus(tx, ctx, id, data))
    return ok(null, data.status === 'INACTIVE' ? 'تم إيقاف الموظف' : 'تمت إعادة تفعيل الموظف')
  } catch (e) {
    return toActionError(e)
  }
}
