'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { saveContractorAction } from '@/app/(app)/contractors/actions'

export interface ContractorFormValue {
  id: number
  name: string
  specialty: string
  phone: string
  nationalId: string
  notes: string
  isActive: boolean
}

const EMPTY = { name: '', specialty: '', phone: '', nationalId: '', notes: '', isActive: true }

export function ContractorDialog({ initial }: { initial?: ContractorFormValue }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? EMPTY)
  const { run, pending, fieldErrors } = useAction(saveContractorAction, {
    onSuccess: (d) => {
      setOpen(false)
      if (!initial) router.push(`/contractors/${d.id}`)
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
            إضافة عامل / مقاول
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل البيانات' : 'إضافة عامل / مقاول'}
        description={initial ? undefined : 'عامل يومي، مقاول، فني صيانة، دهان، كهربائي، سباك...'}
        footer={
          <Button loading={pending} onClick={() => run({ ...v, id: initial?.id ?? null })}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم" required error={fieldErrors.name} className="sm:col-span-2">
            <Input value={v.name} onChange={set('name')} autoFocus />
          </Field>
          <Field label="التخصص / نوع العمل" hint="مثال: دهان، كهربائي، صيانة">
            <Input value={v.specialty} onChange={set('specialty')} />
          </Field>
          <Field label="الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="رقم الهوية">
            <Input value={v.nationalId} onChange={set('nationalId')} dir="ltr" className="text-start" />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
          {initial ? <Checkbox checked={v.isActive} onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))} label="فعال" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
