'use client'

import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { ALL_PERMISSIONS, type Permission } from '@/lib/permissions'
import { deleteRoleAction, saveRoleAction } from '@/app/(app)/users/actions'
import { PermissionMatrix } from './permission-matrix'

export interface RoleValue {
  id: number
  name: string
  description: string
  permissions: Permission[]
}

/** إضافة دور أو تعديل صلاحياته (تسري فورًا على كل مستخدميه). */
export function RoleDialog({ initial, copyFrom }: { initial?: RoleValue; copyFrom?: RoleValue[] }) {
  const [open, setOpen] = React.useState(false)
  const empty: RoleValue = { id: 0, name: '', description: '', permissions: ['dashboard.view'] }
  const [v, setV] = React.useState<RoleValue>(initial ?? empty)
  const { run, pending, fieldErrors } = useAction(saveRoleAction, { onSuccess: () => setOpen(false) })
  const perms = new Set(v.permissions)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(initial ?? empty)
      }}
    >
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="secondary" size="sm">
            <Pencil />
            تعديل الصلاحيات
          </Button>
        ) : (
          <Button size="lg">
            <Plus />
            دور جديد
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        size="2xl"
        title={initial ? `صلاحيات الدور «${initial.name}»` : 'دور جديد'}
        description={`${perms.size} من ${ALL_PERMISSIONS.length} صلاحية`}
        footer={
          <Button loading={pending} onClick={() => run({ id: initial?.id ?? null, name: v.name, description: v.description, permissions: v.permissions })}>
            حفظ الدور
          </Button>
        }
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="اسم الدور" required error={fieldErrors.name}>
            <Input value={v.name} onChange={(e) => setV((p) => ({ ...p, name: e.target.value }))} autoFocus={!initial} />
          </Field>
          <Field label="الوصف" className="sm:col-span-2">
            <Input value={v.description} onChange={(e) => setV((p) => ({ ...p, description: e.target.value }))} />
          </Field>
          {!initial && copyFrom?.length ? (
            <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-3">
              <span className="text-slate-500">ابدأ من صلاحيات:</span>
              {copyFrom.map((r) => (
                <button key={r.id} type="button" className="rounded-full border border-slate-200 px-2.5 py-0.5 text-slate-700 hover:border-brand-300 hover:bg-brand-50" onClick={() => setV((p) => ({ ...p, permissions: [...r.permissions] }))}>
                  {r.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <PermissionMatrix
          isOn={(p) => perms.has(p)}
          onToggle={(p, on) =>
            setV((prev) => {
              const next = new Set(prev.permissions)
              if (on) next.add(p)
              else next.delete(p)
              return { ...prev, permissions: ALL_PERMISSIONS.filter((x) => next.has(x)) }
            })
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export function DeleteRoleButton({ roleId, name }: { roleId: number; name: string }) {
  const [open, setOpen] = React.useState(false)
  const { run, pending } = useAction(deleteRoleAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`حذف ${name}`}>
        <Trash2 />
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`حذف الدور «${name}»؟`} description="الدور غير مستخدم من أي مستخدم." confirmLabel="حذف" danger pending={pending} onConfirm={() => run(roleId)} />
    </>
  )
}
