'use client'

import * as React from 'react'
import { FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createBillAction } from '@/app/(app)/suppliers/actions'

/** فاتورة مورد بالآجل (تُسجل المستحق للمورد) أو رصيد افتتاحي له. */
export function BillDialog({ supplierId, expenseAccounts }: { supplierId: number; expenseAccounts: { id: number; name: string }[] }) {
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const blank = () => ({ date: today, dueDate: '', expenseAccountId: '', amount: '', supplierInvoiceNo: '', description: '', notes: '', isOpening: false })
  const [v, setV] = React.useState(blank)
  const { run, pending, fieldErrors } = useAction(createBillAction, { onSuccess: () => setOpen(false) })
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
          <FilePlus2 />
          فاتورة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent
        title="تسجيل فاتورة مورد (بالآجل)"
        description="الفاتورة تسجل المبلغ مستحقًا للمورد وتُحمّله على نوع المصروف. الدفع يتم لاحقًا بسند صرف «دفعة لمورد». إذا دفعت الفاتورة نقدًا فورًا فاستخدم سند صرف «مصروف» بدلًا منها."
        footer={
          <Button loading={pending} onClick={() => run({ ...v, supplierId, dueDate: v.dueDate || null, expenseAccountId: v.isOpening ? null : v.expenseAccountId })}>
            حفظ الفاتورة
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            className="sm:col-span-2"
            checked={v.isOpening}
            onChange={(e) => setV((p) => ({ ...p, isOpening: e.target.checked }))}
            label="رصيد افتتاحي (مبلغ مستحق للمورد من قبل بدء استخدام النظام)"
          />
          {!v.isOpening ? (
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
          ) : null}
          <Field label="المبلغ" required error={fieldErrors.amount}>
            <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} />
          </Field>
          <Field label="تاريخ الفاتورة" required error={fieldErrors.date}>
            <Input type="date" value={v.date} onChange={set('date')} />
          </Field>
          {!v.isOpening ? (
            <>
              <Field label="تاريخ الاستحقاق" error={fieldErrors.dueDate}>
                <Input type="date" value={v.dueDate} onChange={set('dueDate')} />
              </Field>
              <Field label="رقم فاتورة المورد">
                <Input value={v.supplierInvoiceNo} onChange={set('supplierInvoiceNo')} dir="ltr" className="text-start" />
              </Field>
            </>
          ) : null}
          <Field label="البيان" className="sm:col-span-2">
            <Input value={v.description} onChange={set('description')} />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
