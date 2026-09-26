'use server'

import { transaction } from '@/server/db'
import { actionContext, assertCan } from '@/server/auth/guard'
import { ok, toActionError, type ActionResult } from '@/server/errors'
import {
  addEmployeeToRun,
  approveRun,
  cancelOvertime,
  cancelRun,
  createOvertime,
  createPayrollRun,
  recalculateRun,
  removePayrollItem,
  updatePayrollItem,
} from '@/server/services/payroll'
import { paySalaries } from '@/server/services/payroll-pay'
import { createAdvance, updateAdvanceSchedule } from '@/server/services/advances'
import { advanceScheduleSchema, advanceSchema, createRunSchema, overtimeSchema, payRunSchema, payrollItemSchema, runReasonSchema } from '@/lib/schemas/payroll'
import { cancelDocSchema } from '@/lib/schemas/treasury'
import { id as idSchema } from '@/lib/schemas/common'

export async function createRunAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const data = createRunSchema.parse(input)
    const run = await transaction((tx) => createPayrollRun(tx, ctx, data), { timeout: 120_000 })
    return ok({ id: run.id }, `تم احتساب رواتب شهر ${run.month}/${run.year} (مسودة)`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function recalcRunAction(runId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const id = idSchema.parse(runId)
    await transaction((tx) => recalculateRun(tx, ctx, id), { timeout: 120_000 })
    return ok(null, 'تمت إعادة الاحتساب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateItemAction(input: unknown): Promise<ActionResult<{ netPay: string }>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const { id, ...data } = payrollItemSchema.parse(input)
    const item = await transaction((tx) => updatePayrollItem(tx, ctx, id, data))
    return ok({ netPay: item.netPay.toString() })
  } catch (e) {
    return toActionError(e)
  }
}

export async function removeItemAction(itemId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const id = idSchema.parse(itemId)
    await transaction((tx) => removePayrollItem(tx, ctx, id))
    return ok(null, 'تم استبعاد الموظف من المسودة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function addEmployeeToRunAction(input: { runId: number; employeeId: number }): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('payroll.manage')
    await transaction((tx) => addEmployeeToRun(tx, ctx, idSchema.parse(input.runId), idSchema.parse(input.employeeId)))
    return ok(null, 'تمت إضافة الموظف إلى المسودة')
  } catch (e) {
    return toActionError(e)
  }
}

export async function approveRunAction(runId: number): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const id = idSchema.parse(runId)
    await transaction((tx) => approveRun(tx, ctx, id), { timeout: 120_000 })
    return ok(null, 'تم اعتماد المسير وتسجيل قيد الرواتب')
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelRunAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('payroll.manage')
    const { id, reason } = runReasonSchema.parse(input)
    await transaction((tx) => cancelRun(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء المسير')
  } catch (e) {
    return toActionError(e)
  }
}

export async function payRunAction(input: unknown): Promise<ActionResult<{ count: number; total: string }>> {
  try {
    const ctx = await actionContext('payroll.pay')
    assertCan(ctx, 'vouchers.create', 'صرف الرواتب يتطلب صلاحية إنشاء سندات الصرف')
    const data = payRunSchema.parse(input)
    const res = await transaction((tx) => paySalaries(tx, ctx, data), { timeout: 120_000 })
    return ok({ count: res.count, total: res.total }, `تم صرف رواتب ${res.count} موظف`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function createOvertimeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('overtime.manage')
    const data = overtimeSchema.parse(input)
    await transaction((tx) => createOvertime(tx, ctx, data))
    return ok(null, 'تم تسجيل الساعات الإضافية')
  } catch (e) {
    return toActionError(e)
  }
}

export async function cancelOvertimeAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('overtime.manage')
    const { id, reason } = cancelDocSchema.parse(input)
    await transaction((tx) => cancelOvertime(tx, ctx, id, reason))
    return ok(null, 'تم إلغاء الساعات الإضافية')
  } catch (e) {
    return toActionError(e)
  }
}

export async function createAdvanceAction(input: unknown): Promise<ActionResult<{ voucherId: number; number: string }>> {
  try {
    const ctx = await actionContext('advances.manage')
    assertCan(ctx, 'vouchers.create', 'صرف السلفة يتطلب صلاحية إنشاء سندات الصرف')
    const data = advanceSchema.parse(input)
    const { voucher } = await transaction((tx) => createAdvance(tx, ctx, data))
    return ok({ voucherId: voucher.id, number: voucher.number }, `تم صرف السلفة بالسند ${voucher.number}`)
  } catch (e) {
    return toActionError(e)
  }
}

export async function updateAdvanceAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const ctx = await actionContext('advances.manage')
    const { id, ...data } = advanceScheduleSchema.parse(input)
    await transaction((tx) => updateAdvanceSchedule(tx, ctx, id, data))
    return ok(null, 'تم تعديل جدول خصم السلفة')
  } catch (e) {
    return toActionError(e)
  }
}
