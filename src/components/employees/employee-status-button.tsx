'use client'

import * as React from 'react'
import { UserCheck, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { setEmployeeStatusAction } from '@/app/(app)/employees/actions'

/** إيقاف موظف (انتهاء خدمة) أو إعادة تفعيله. الموظف غير الفعال لا يدخل المسيرات الجديدة. */
export function EmployeeStatusButton({ employeeId, active }: { employeeId: number; active: boolean }) {
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState({ endDate: today, reason: '' })
  const { run, pending } = useAction(setEmployeeStatusAction, { onSuccess: () => setOpen(false) })
  if (!active) {
    return (
      <Button variant="secondary" loading={pending} onClick={() => run({ id: employeeId, status: 'ACTIVE' })}>
        <UserCheck />
        إعادة تفعيل
      </Button>
    )
  }
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <UserX />
        إيقاف / انتهاء خدمة
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="إيقاف الموظف"
          description="يبقى الموظف وسجله المالي محفوظًا، لكنه لا يدخل في مسيرات الرواتب الجديدة."
          size="sm"
          footer={
            <Button variant="danger" loading={pending} onClick={() => run({ id: employeeId, status: 'INACTIVE', endDate: v.endDate, reason: v.reason })}>
              إيقاف الموظف
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="تاريخ انتهاء الخدمة">
              <Input type="date" value={v.endDate} onChange={(e) => setV((p) => ({ ...p, endDate: e.target.value }))} />
            </Field>
            <Field label="السبب">
              <Input value={v.reason} onChange={(e) => setV((p) => ({ ...p, reason: e.target.value }))} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
