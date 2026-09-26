'use client'

import * as React from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { addSectionAction, removeSectionAction, saveGradeAction, saveStageAction } from '@/app/(app)/settings/actions'

interface GradeVal {
  id?: number
  name: string
  stageId: string
  sortOrder: string
  nextGradeId: string
  isActive: boolean
}

export function GradeDialog({
  initial,
  stages,
  grades,
}: {
  initial?: GradeVal
  stages: { id: number; name: string }[]
  grades: { id: number; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState<GradeVal>(initial ?? { name: '', stageId: '', sortOrder: String(grades.length + 1), nextGradeId: '', isActive: true })
  const { run, pending, fieldErrors } = useAction(saveGradeAction, { onSuccess: () => setOpen(false) })
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
            إضافة صف
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? 'تعديل الصف' : 'إضافة صف'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                run({
                  id: v.id ?? null,
                  name: v.name,
                  stageId: v.stageId || null,
                  sortOrder: v.sortOrder,
                  nextGradeId: v.nextGradeId || null,
                  isActive: v.isActive,
                })
              }
            >
              حفظ
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="اسم الصف" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="المرحلة">
            <Select value={v.stageId} onChange={(e) => setV({ ...v, stageId: e.target.value })}>
              <option value="">—</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الترتيب">
            <Input value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value.replace(/\D/g, '') })} dir="ltr" className="text-left" />
          </Field>
          <Field label="الصف التالي عند الترحيل" hint="اتركه فارغًا للصف الأخير (يُعتبر الطالب متخرجًا)">
            <Select value={v.nextGradeId} onChange={(e) => setV({ ...v, nextGradeId: e.target.value })}>
              <option value="">— تخرج —</option>
              {grades
                .filter((g) => g.id !== v.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Checkbox checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} label="فعال" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SectionsEditor({ gradeId, sections }: { gradeId: number; sections: { id: number; name: string }[] }) {
  const [name, setName] = React.useState('')
  const add = useAction((n: string) => addSectionAction(gradeId, n), { onSuccess: () => setName('') })
  const remove = useAction(removeSectionAction)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sections.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pe-1 ps-2.5 text-sm">
          {s.name}
          <button type="button" onClick={() => remove.run(s.id)} className="rounded-full p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600" aria-label="حذف الشعبة">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <form
        className="inline-flex"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) add.run(name.trim())
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="+ شعبة" className="h-7 w-20 rounded-full px-2 text-sm" />
      </form>
    </div>
  )
}

export function StageDialog() {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const { run, pending } = useAction(saveStageAction, { onSuccess: () => { setOpen(false); setName('') } })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Plus />
          مرحلة
        </Button>
      </DialogTrigger>
      <DialogContent
        title="إضافة مرحلة"
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ name })}>
            حفظ
          </Button>
        }
      >
        <Field label="اسم المرحلة" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: المرحلة الأساسية العليا" />
        </Field>
      </DialogContent>
    </Dialog>
  )
}
