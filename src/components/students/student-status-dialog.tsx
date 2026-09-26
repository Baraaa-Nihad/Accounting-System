'use client'

import * as React from 'react'
import { UserCog } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp, useCan } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { changeStudentStatusAction } from '@/app/(app)/students/actions'
import { STUDENT_STATUS } from '@/lib/labels'

export function StudentStatusDialog({ studentId, current }: { studentId: number; current: string }) {
  const { today } = useApp()
  const can = useCan()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState(current === 'ACTIVE' ? 'WITHDRAWN' : 'ACTIVE')
  const [reason, setReason] = React.useState('')
  const [date, setDate] = React.useState(today)
  const [cancelFuture, setCancelFuture] = React.useState(false)
  const { run, pending, fieldErrors } = useAction(changeStudentStatusAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <UserCog />
          تغيير الحالة
        </Button>
      </DialogTrigger>
      <DialogContent
        title="تغيير حالة الطالب"
        description="الطالب المنسحب أو المتخرج يبقى في السجلات وتقارير الذمم حتى تسوية حسابه."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button loading={pending} onClick={() => run({ studentId, status, reason, date, cancelFutureInstallments: status === 'WITHDRAWN' && cancelFuture })}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="الحالة الجديدة">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STUDENT_STATUS)
                .filter(([k]) => k !== current)
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="التاريخ">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="السبب" error={fieldErrors.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          {status === 'WITHDRAWN' && can('charges.cancel') ? (
            <Checkbox
              checked={cancelFuture}
              onChange={(e) => setCancelFuture(e.target.checked)}
              label="إلغاء الأقساط غير المستحقة بعد تاريخ الانسحاب"
              description="تُلغى الأقساط التي لم يحن موعدها ولم يُدفع منها شيء، ويُخفض الإيراد بقيد محاسبي"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
