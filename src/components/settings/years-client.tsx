'use client'

import * as React from 'react'
import { Plus, Star } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { createYearAction, setCurrentYearAction } from '@/app/(app)/settings/actions'

export function NewYearDialog({ suggestion }: { suggestion: { name: string; startDate: string; endDate: string } }) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState({ ...suggestion, makeCurrent: false })
  const { run, pending, fieldErrors } = useAction(createYearAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus />
          سنة دراسية جديدة
        </Button>
      </DialogTrigger>
      <DialogContent
        title="سنة دراسية جديدة"
        description="السنة الدراسية هي أيضًا السنة المالية: كل حركة مالية تتبع السنة التي يقع فيها تاريخها."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button loading={pending} onClick={() => run(v)}>
              إنشاء
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="الاسم" required error={fieldErrors.name} hint="مثال: 2027/2028">
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="تاريخ البداية" required error={fieldErrors.startDate}>
            <Input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
          </Field>
          <Field label="تاريخ النهاية" required error={fieldErrors.endDate}>
            <Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
          </Field>
          <Checkbox checked={v.makeCurrent} onChange={(e) => setV({ ...v, makeCurrent: e.target.checked })} label="تعيينها السنة الحالية" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SetCurrentYearButton({ yearId }: { yearId: number }) {
  const { run, pending } = useAction(setCurrentYearAction)
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(yearId)}>
      {!pending ? <Star /> : null}
      تعيين كحالية
    </Button>
  )
}
