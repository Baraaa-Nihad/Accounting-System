'use client'

import * as React from 'react'
import { ClipboardPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createJobAction } from '@/app/(app)/contractors/actions'

/** عمل/اتفاق جديد مع عامل أو مقاول: يُسجل المبلغ المتفق عليه مستحقًا له. */
export function JobDialog({ contractorId, expenseAccounts }: { contractorId: number; expenseAccounts: { id: number; name: string }[] }) {
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const blank = () => ({ description: '', agreedAmount: '', startDate: today, endDate: '', expenseAccountId: '', notes: '' })
  const [v, setV] = React.useState(blank)
  const { run, pending, fieldErrors } = useAction(createJobAction, { onSuccess: () => setOpen(false) })
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }))
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
          <ClipboardPlus />
          عمل / اتفاق جديد
        </Button>
      </DialogTrigger>
      <DialogContent
        title="عمل أو اتفاق جديد"
        description="مثال: دهان 5 صفوف بمبلغ 3000. يُسجل المبلغ مستحقًا للعامل، ثم تُصرف له دفعات حتى السداد."
        footer={
          <Button loading={pending} onClick={() => run({ ...v, contractorId, endDate: v.endDate || null })}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="وصف العمل" required error={fieldErrors.description} className="sm:col-span-2">
            <Input value={v.description} onChange={set('description')} placeholder="مثال: دهان الصفوف في الطابق الأول" />
          </Field>
          <Field label="المبلغ المتفق عليه" required error={fieldErrors.agreedAmount}>
            <MoneyInput value={v.agreedAmount} onChange={(x) => setV((p) => ({ ...p, agreedAmount: x }))} />
          </Field>
          <Field label="نوع المصروف" required error={fieldErrors.expenseAccountId}>
            <Select value={v.expenseAccountId} onChange={set('expenseAccountId')}>
              <option value="">اختر</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تاريخ البدء" required error={fieldErrors.startDate}>
            <Input type="date" value={v.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="تاريخ الانتهاء المتوقع" error={fieldErrors.endDate}>
            <Input type="date" value={v.endDate} onChange={set('endDate')} />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
