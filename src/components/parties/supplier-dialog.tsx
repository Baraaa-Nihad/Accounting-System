'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { saveSupplierAction } from '@/app/(app)/suppliers/actions'

export interface SupplierFormValue {
  id: number
  name: string
  category: string
  phone: string
  email: string
  contactPerson: string
  address: string
  taxNumber: string
  notes: string
  isActive: boolean
}

const EMPTY = { name: '', category: '', phone: '', email: '', contactPerson: '', address: '', taxNumber: '', notes: '', isActive: true }

export function SupplierDialog({ initial }: { initial?: SupplierFormValue }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? EMPTY)
  const { run, pending, fieldErrors } = useAction(saveSupplierAction, {
    onSuccess: (d) => {
      setOpen(false)
      if (!initial) router.push(`/suppliers/${d.id}`)
    },
  })
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(initial ?? EMPTY)
      }}
    >
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="ghost">
            <Pencil />
            تعديل
          </Button>
        ) : (
          <Button size="lg">
            <Plus />
            إضافة مورد
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل بيانات المورد' : 'إضافة مورد'}
        footer={
          <Button loading={pending} onClick={() => run({ ...v, id: initial?.id ?? null })}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المورد" required error={fieldErrors.name} className="sm:col-span-2">
            <Input value={v.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="التصنيف" hint="مثال: قرطاسية، صيانة، أغذية">
            <Input value={v.category} onChange={set('category')} />
          </Field>
          <Field label="الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="الشخص المسؤول">
            <Input value={v.contactPerson} onChange={set('contactPerson')} />
          </Field>
          <Field label="البريد الإلكتروني" error={fieldErrors.email}>
            <Input value={v.email} onChange={set('email')} dir="ltr" className="text-start" />
          </Field>
          <Field label="العنوان">
            <Input value={v.address} onChange={set('address')} />
          </Field>
          <Field label="الرقم الضريبي">
            <Input value={v.taxNumber} onChange={set('taxNumber')} dir="ltr" className="text-start" />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
          {initial ? <Checkbox checked={v.isActive} onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))} label="مورد فعال" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
