'use client'

import * as React from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createOvertimeAction } from '@/app/(app)/payroll/actions'
import { D, round } from '@/lib/money'

export interface OvertimeEmployee {
  id: number
  fullName: string
  /** سعر الساعة الافتراضي (من ملف الموظف أو المشتق من راتبه) */
  defaultRate: string | null
}

/** تسجيل ساعات إضافية: القيمة = الساعات × السعر، وتُصرف مع راتب الشهر. */
export function OvertimeDialog({ employees, fixedEmployeeId }: { employees: OvertimeEmployee[]; fixedEmployeeId?: number }) {
  const { today } = useApp()
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const blank = () => ({ employeeId: fixedEmployeeId ? String(fixedEmployeeId) : '', date: today, hours: '', rate: '', reason: '' })
  const [v, setV] = React.useState(blank)
  const { run, pending, fieldErrors } = useAction(createOvertimeAction, { onSuccess: () => setOpen(false) })
  const emp = employees.find((e) => String(e.id) === v.employeeId)
  const rate = v.rate || emp?.defaultRate || ''
  const amount = v.hours && rate ? round(D(v.hours).times(D(rate)), f.cfg.decimals) : null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(blank())
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Clock />
          تسجيل ساعات إضافية
        </Button>
      </DialogTrigger>
      <DialogContent
        title="تسجيل ساعات إضافية"
        description="تبقى «معلّقة» حتى تُصرف تلقائيًا مع مسير رواتب الشهر."
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ ...v, rate: v.rate || null })}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedEmployeeId ? (
            <Field label="الموظف" required error={fieldErrors.employeeId} className="sm:col-span-2">
              <Select value={v.employeeId} onChange={(e) => setV((p) => ({ ...p, employeeId: e.target.value }))}>
                <option value="">اختر الموظف</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="التاريخ" required error={fieldErrors.date}>
            <Input type="date" value={v.date} onChange={(e) => setV((p) => ({ ...p, date: e.target.value }))} />
          </Field>
          <Field label="عدد الساعات" required error={fieldErrors.hours}>
            <Input value={v.hours} onChange={(e) => setV((p) => ({ ...p, hours: e.target.value.replace(/[^\d.]/g, '') }))} dir="ltr" className="text-center" inputMode="decimal" />
          </Field>
          <Field label="سعر الساعة" error={fieldErrors.rate} hint={emp?.defaultRate ? `الافتراضي ${f.moneyText(emp.defaultRate)}` : undefined}>
            <MoneyInput value={v.rate} onChange={(x) => setV((p) => ({ ...p, rate: x }))} placeholder={emp?.defaultRate ?? ''} />
          </Field>
          <Field label="القيمة">
            <p className="flex h-10 items-center text-lg font-bold">{amount ? f.money(amount) : '—'}</p>
          </Field>
          <Field label="السبب" className="sm:col-span-2">
            <Input value={v.reason} onChange={(e) => setV((p) => ({ ...p, reason: e.target.value }))} placeholder="مثال: حصص تقوية بعد الدوام" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
