'use client'

import * as React from 'react'
import { Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { updateGuardianAction } from '@/app/(app)/students/actions'

export function GuardianEditDialog({
  guardian,
}: {
  guardian: { id: number; name: string; phone: string | null; phone2: string | null; relation: string | null; nationalId: string | null; email: string | null; address: string | null; notes: string | null }
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState({
    name: guardian.name,
    phone: guardian.phone ?? '',
    phone2: guardian.phone2 ?? '',
    relation: guardian.relation ?? '',
    nationalId: guardian.nationalId ?? '',
    email: guardian.email ?? '',
    address: guardian.address ?? '',
    notes: guardian.notes ?? '',
  })
  const { run, pending, fieldErrors } = useAction(
    React.useCallback((input: unknown) => updateGuardianAction(guardian.id, input), [guardian.id]),
    { onSuccess: () => setOpen(false) },
  )
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Pencil />
          تعديل بيانات ولي الأمر
        </Button>
      </DialogTrigger>
      <DialogContent
        title="تعديل بيانات ولي الأمر"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button loading={pending} onClick={() => run(v)}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم" required error={fieldErrors.name}>
            <Input value={v.name} onChange={set('name')} />
          </Field>
          <Field label="الهاتف" required error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" />
          </Field>
          <Field label="هاتف إضافي">
            <Input value={v.phone2} onChange={set('phone2')} dir="ltr" className="text-start" />
          </Field>
          <Field label="صلة القرابة">
            <Input value={v.relation} onChange={set('relation')} />
          </Field>
          <Field label="رقم الهوية">
            <Input value={v.nationalId} onChange={set('nationalId')} dir="ltr" className="text-start" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input value={v.email} onChange={set('email')} dir="ltr" className="text-start" />
          </Field>
          <Field label="العنوان" className="sm:col-span-2">
            <Input value={v.address} onChange={set('address')} />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
