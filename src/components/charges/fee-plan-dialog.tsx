'use client'

import * as React from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useAction } from '@/lib/use-action'
import { deleteFeePlanAction, saveFeePlanAction } from '@/app/(app)/charges/actions'

export interface FeePlanValue {
  id?: number
  gradeId: string
  chargeTypeId: string
  amount: string
  installmentsCount: string
  firstDueDate: string
  dueDay: string
  notes: string
}

export function FeePlanDialog({
  yearId,
  grades,
  chargeTypes,
  initial,
}: {
  yearId: number
  grades: { id: number; name: string }[]
  chargeTypes: { id: number; name: string }[]
  initial?: FeePlanValue
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState<FeePlanValue>(
    initial ?? { gradeId: '', chargeTypeId: '', amount: '', installmentsCount: '1', firstDueDate: '', dueDay: '', notes: '' },
  )
  const { run, pending, fieldErrors } = useAction(saveFeePlanAction, { onSuccess: () => setOpen(false) })
  const set = (k: keyof FeePlanValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {initial ? (
          <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="تعديل">
            <Pencil className="size-4" />
          </button>
        ) : (
          <Button size="lg">
            <Plus />
            إضافة رسوم مقررة
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل الرسوم المقررة' : 'إضافة رسوم مقررة'}
        description="المبلغ المعتمد لنوع رسوم في صف معين؛ يُستخدم عند إضافة طالب جديد وعند الإصدار الجماعي."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button loading={pending} onClick={() => run({ ...v, academicYearId: yearId })}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الصف" required error={fieldErrors.gradeId}>
            <Select value={v.gradeId} onChange={set('gradeId')} disabled={!!initial}>
              <option value="">اختر الصف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="نوع الذمة" required error={fieldErrors.chargeTypeId}>
            <Select value={v.chargeTypeId} onChange={set('chargeTypeId')} disabled={!!initial}>
              <option value="">اختر النوع</option>
              {chargeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المبلغ" required error={fieldErrors.amount}>
            <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} />
          </Field>
          <Field label="عدد الأقساط" hint="1 = دفعة واحدة">
            <Input value={v.installmentsCount} onChange={set('installmentsCount')} dir="ltr" className="num text-left" />
          </Field>
          <Field label="تاريخ أول قسط / الاستحقاق">
            <Input type="date" value={v.firstDueDate} onChange={set('firstDueDate')} />
          </Field>
          <Field label="يوم الاستحقاق الشهري">
            <Input value={v.dueDay} onChange={set('dueDay')} placeholder="تلقائي" dir="ltr" className="num text-left" />
          </Field>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FeePlanDelete({ id }: { id: number }) {
  const { run, pending } = useAction(deleteFeePlanAction)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm('حذف هذه الرسوم المقررة؟ (لا يؤثر على الذمم الصادرة سابقًا)')) run(id)
      }}
      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
      aria-label="حذف"
    >
      <Trash2 className="size-4" />
    </button>
  )
}
