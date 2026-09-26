'use client'

import * as React from 'react'
import { Plus, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useAction } from '@/lib/use-action'
import { saveCategoryAction, saveChargeTypeAction, saveDiscountTypeAction } from '@/app/(app)/settings/actions'

function TriggerButton({ edit, label }: { edit: boolean; label: string }) {
  return edit ? (
    <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="تعديل">
      <Pencil className="size-4" />
    </button>
  ) : (
    <Button size="lg">
      <Plus />
      {label}
    </Button>
  )
}

export function ChargeTypeDialog({
  initial,
}: {
  initial?: { id: number; name: string; defaultAmount: string; allowInstallments: boolean; isActive: boolean; description: string; system: boolean }
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? { name: '', defaultAmount: '', allowInstallments: false, isActive: true, description: '', system: false })
  const { run, pending, fieldErrors } = useAction(saveChargeTypeAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span>
          <TriggerButton edit={!!initial} label="تصنيف ذمة جديد" />
        </span>
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل تصنيف الذمة' : 'تصنيف ذمة جديد'}
        description={initial ? undefined : 'سيُنشأ حساب إيراد خاص بهذا التصنيف تلقائيًا في دليل الحسابات.'}
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ id: initial?.id ?? null, name: v.name, defaultAmount: v.defaultAmount, allowInstallments: v.allowInstallments, isActive: v.isActive, description: v.description })}>
            حفظ
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="الاسم" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} disabled={v.system} />
          </Field>
          <Field label="المبلغ الافتراضي" hint="يُقترح تلقائيًا عند إضافة ذمة من هذا النوع (اختياري)">
            <MoneyInput value={v.defaultAmount} onChange={(x) => setV({ ...v, defaultAmount: x })} />
          </Field>
          <Field label="الوصف">
            <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Field>
          <Checkbox checked={v.allowInstallments} onChange={(e) => setV({ ...v, allowInstallments: e.target.checked })} label="التقسيط مفعل افتراضيًا لهذا النوع" />
          <Checkbox checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="فعال (يظهر في القوائم)" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function DiscountTypeDialog({
  initial,
}: {
  initial?: { id: number; name: string; defaultMethod: string; defaultValue: string; isActive: boolean; description: string }
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? { name: '', defaultMethod: '', defaultValue: '', isActive: true, description: '' })
  const { run, pending, fieldErrors } = useAction(saveDiscountTypeAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span>
          <TriggerButton edit={!!initial} label="نوع خصم جديد" />
        </span>
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل نوع الخصم' : 'نوع خصم جديد'}
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ id: initial?.id ?? null, ...v })}>
            حفظ
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="الاسم" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="مثال: خصم إخوة" />
          </Field>
          <Field label="الطريقة الافتراضية">
            <Select value={v.defaultMethod} onChange={(e) => setV({ ...v, defaultMethod: e.target.value })}>
              <option value="">—</option>
              <option value="PERCENT">نسبة مئوية</option>
              <option value="FIXED">مبلغ ثابت</option>
            </Select>
          </Field>
          <Field label="القيمة الافتراضية">
            <Input value={v.defaultValue} onChange={(e) => setV({ ...v, defaultValue: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Checkbox checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="فعال" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CategoryDialog({
  kind,
  initial,
}: {
  kind: 'EXPENSE' | 'OTHER_REVENUE'
  initial?: { id: number; name: string; isActive: boolean; description: string; system: boolean }
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState(initial ?? { name: '', isActive: true, description: '', system: false })
  const { run, pending, fieldErrors } = useAction(saveCategoryAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span>
          <TriggerButton edit={!!initial} label={kind === 'EXPENSE' ? 'تصنيف مصروف جديد' : 'تصنيف إيراد جديد'} />
        </span>
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل التصنيف' : kind === 'EXPENSE' ? 'تصنيف مصروف جديد' : 'تصنيف إيراد جديد'}
        description={initial ? undefined : 'يُنشأ حسابه في دليل الحسابات تلقائيًا.'}
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ id: initial?.id ?? null, kind, name: v.name, isActive: v.isActive, description: v.description })}>
            حفظ
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="الاسم" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="الوصف">
            <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Field>
          {!v.system ? <Checkbox checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="فعال" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
