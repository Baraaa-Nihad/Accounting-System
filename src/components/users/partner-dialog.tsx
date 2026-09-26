'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { savePartnerAction } from '@/app/(app)/partners/actions'

export interface PartnerFormValue {
  id: number
  name: string
  phone: string
  email: string
  ownershipPercent: string
  userId: string
  joinDate: string
  notes: string
  isActive: boolean
}

const EMPTY = { name: '', phone: '', email: '', ownershipPercent: '', userId: '', joinDate: '', notes: '', isActive: true }

export function PartnerDialog({ initial, users, remainingPercent }: { initial?: PartnerFormValue; users: { id: number; label: string }[]; remainingPercent: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? EMPTY)
  const { run, pending, fieldErrors } = useAction(savePartnerAction, {
    onSuccess: (d) => {
      setOpen(false)
      if (!initial) router.push(`/partners/${d.id}`)
    },
  })
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
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
          <Button variant="secondary">
            <Pencil />
            تعديل
          </Button>
        ) : (
          <Button size="lg">
            <Plus />
            إضافة شريك
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل بيانات الشريك' : 'إضافة شريك'}
        description={initial ? undefined : 'يُنشأ للشريك تلقائيًا حساب رأس مال وحساب جارٍ في دليل الحسابات.'}
        footer={
          <Button loading={pending} onClick={() => run({ ...v, id: initial?.id ?? null })}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم الشريك" required error={fieldErrors.name} className="sm:col-span-2">
            <Input value={v.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="نسبة الملكية %" required error={fieldErrors.ownershipPercent} hint={`المتاح من غير المخصص: ${remainingPercent}%`}>
            <Input value={v.ownershipPercent} onChange={set('ownershipPercent')} dir="ltr" className="num text-start" inputMode="decimal" />
          </Field>
          <Field label="تاريخ الانضمام" error={fieldErrors.joinDate}>
            <Input type="date" value={v.joinDate} onChange={set('joinDate')} />
          </Field>
          <Field label="الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="البريد الإلكتروني" error={fieldErrors.email}>
            <Input value={v.email} onChange={set('email')} dir="ltr" className="text-start" />
          </Field>
          <Field label="حساب الدخول للنظام" error={fieldErrors.userId} hint="اختياري: ربط الشريك بمستخدم (عادةً بدور «شريك»)" className="sm:col-span-2">
            <Select value={v.userId} onChange={set('userId')}>
              <option value="">— بدون —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
          {initial ? <Checkbox checked={v.isActive} onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))} label="شريك فعّال" description="الشريك غير الفعال لا يدخل في مجموع نسب الملكية" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
