'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { createUserAction } from '@/app/(app)/users/actions'
import { randomPassword } from './permission-matrix'

export interface RoleOption {
  id: number
  name: string
  key: string | null
  description: string | null
  permissions: string[]
}

/** إضافة مستخدم: بيانات الدخول + الدور. التخصيص الدقيق للصلاحيات من صفحة المستخدم. */
export function NewUserDialog({ roles }: { roles: RoleOption[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const empty = () => ({ username: '', fullName: '', phone: '', email: '', roleId: String(roles.find((r) => r.key === 'clerk')?.id ?? roles[0]?.id ?? ''), password: randomPassword() })
  const [v, setV] = React.useState(empty)
  const { run, pending, fieldErrors } = useAction(createUserAction, {
    onSuccess: (d) => {
      setOpen(false)
      router.push(`/users/${d.id}`)
    },
  })
  const set = (k: keyof ReturnType<typeof empty>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
  const role = roles.find((r) => String(r.id) === v.roleId)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(empty())
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg">
          <Plus />
          إضافة مستخدم
        </Button>
      </DialogTrigger>
      <DialogContent
        title="إضافة مستخدم"
        description="سلّم المستخدم كلمة المرور المؤقتة؛ سيُطلب منه تغييرها عند أول دخول."
        footer={
          <Button loading={pending} onClick={() => run({ ...v, extraPermissions: [], revokedPermissions: [] })}>
            إضافة
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم الكامل" required error={fieldErrors.fullName} className="sm:col-span-2">
            <Input value={v.fullName} onChange={set('fullName')} autoFocus />
          </Field>
          <Field label="اسم المستخدم (للدخول)" required error={fieldErrors.username} hint="أحرف إنجليزية صغيرة وأرقام، مثل: ahmad.ali">
            <Input value={v.username} onChange={set('username')} dir="ltr" className="text-start" autoComplete="off" />
          </Field>
          <Field label="كلمة المرور المؤقتة" required error={fieldErrors.password}>
            <div className="flex gap-2">
              <Input value={v.password} onChange={set('password')} dir="ltr" className="num text-start" autoComplete="off" />
              <Button variant="secondary" size="icon" aria-label="توليد كلمة مرور" onClick={() => setV((p) => ({ ...p, password: randomPassword() }))}>
                <RefreshCw />
              </Button>
            </div>
          </Field>
          <Field label="الدور" required error={fieldErrors.roleId} hint={role?.description ?? undefined} className="sm:col-span-2">
            <Select value={v.roleId} onChange={set('roleId')}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="البريد الإلكتروني" error={fieldErrors.email}>
            <Input value={v.email} onChange={set('email')} dir="ltr" className="text-start" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
