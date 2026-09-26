'use client'

import * as React from 'react'
import { FolderPlus, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { createAccountAction, updateAccountAction } from '@/app/(app)/accounting/actions'

export interface GroupOption {
  id: number
  code: string
  name: string
  depth: number
}

/** حساب جديد تحت حساب تجميعي (الرمز يُولّد تلقائيًا أو يُدخل يدويًا). */
export function NewAccountDialog({ groups, defaultParentId }: { groups: GroupOption[]; defaultParentId?: number }) {
  const [open, setOpen] = React.useState(false)
  const empty = () => ({ parentId: String(defaultParentId ?? groups[0]?.id ?? ''), name: '', code: '', description: '', isGroup: false })
  const [v, setV] = React.useState(empty)
  const { run, pending, fieldErrors } = useAction(createAccountAction, { onSuccess: () => setOpen(false) })
  const parent = groups.find((g) => String(g.id) === v.parentId)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(empty())
      }}
    >
      <DialogTrigger asChild>
        {defaultParentId ? (
          <Button variant="ghost" size="icon-sm" aria-label="حساب فرعي جديد">
            <Plus />
          </Button>
        ) : (
          <Button size="lg">
            <FolderPlus />
            حساب جديد
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="حساب جديد في دليل الحسابات"
        description="نوع الحساب (أصل، التزام، إيراد...) يُؤخذ من الحساب الرئيسي."
        footer={
          <Button loading={pending} onClick={() => run({ ...v, code: v.code || null })}>
            إضافة
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تحت الحساب الرئيسي" required error={fieldErrors.parentId} className="sm:col-span-2">
            <Select value={v.parentId} onChange={(e) => setV((p) => ({ ...p, parentId: e.target.value }))}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {' '.repeat(g.depth * 3)}
                  {g.code} — {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="اسم الحساب" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV((p) => ({ ...p, name: e.target.value }))} autoFocus />
          </Field>
          <Field label="الرمز" error={fieldErrors.code} hint={`اتركه فارغًا ليُولّد تلقائيًا${parent ? ` (يبدأ بـ ${parent.code})` : ''}`}>
            <Input value={v.code} onChange={(e) => setV((p) => ({ ...p, code: e.target.value }))} dir="ltr" className="num text-start" inputMode="numeric" />
          </Field>
          <Field label="الوصف" className="sm:col-span-2">
            <Input value={v.description} onChange={(e) => setV((p) => ({ ...p, description: e.target.value }))} />
          </Field>
          <Checkbox
            className="sm:col-span-2"
            checked={v.isGroup}
            onChange={(e) => setV((p) => ({ ...p, isGroup: e.target.checked }))}
            label="حساب تجميعي"
            description="يحتوي حسابات فرعية ولا يُرحّل إليه مباشرة"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function EditAccountDialog({ account }: { account: { id: number; code: string; name: string; description: string | null; isActive: boolean; isSystem: boolean } }) {
  const [open, setOpen] = React.useState(false)
  const initial = { name: account.name, description: account.description ?? '', isActive: account.isActive }
  const [v, setV] = React.useState(initial)
  const { run, pending, fieldErrors } = useAction(updateAccountAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(initial)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`تعديل ${account.name}`}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`تعديل الحساب ${account.code}`}
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ id: account.id, ...v })}>
            حفظ
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="اسم الحساب" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="الوصف">
            <Input value={v.description} onChange={(e) => setV((p) => ({ ...p, description: e.target.value }))} />
          </Field>
          {account.isSystem ? (
            <p className="text-xs text-slate-500">حساب أساسي في النظام: يمكن تعديل اسمه ووصفه فقط.</p>
          ) : (
            <Checkbox checked={v.isActive} onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))} label="حساب فعّال" description="التعطيل متاح فقط إذا كان الرصيد صفرًا" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
