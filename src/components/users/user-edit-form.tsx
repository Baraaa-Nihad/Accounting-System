'use client'

import * as React from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { ADMIN_ROLE_KEY, ALL_PERMISSIONS, type Permission } from '@/lib/permissions'
import { updateUserAction } from '@/app/(app)/users/actions'
import { PermissionMatrix } from './permission-matrix'
import type { RoleOption } from './user-dialog'

export interface EditableUser {
  id: number
  username: string
  fullName: string
  email: string
  phone: string
  roleId: number
  extraPermissions: Permission[]
  revokedPermissions: Permission[]
  isActive: boolean
}

/** بيانات المستخدم ودوره وتخصيص صلاحياته (إضافة/حجب فوق صلاحيات الدور). */
export function UserEditForm({ user, roles, isSelf }: { user: EditableUser; roles: RoleOption[]; isSelf: boolean }) {
  const [v, setV] = React.useState(user)
  const { run, pending, fieldErrors } = useAction(updateUserAction)
  const role = roles.find((r) => r.id === v.roleId)
  const isAdmin = role?.key === ADMIN_ROLE_KEY
  const rolePerms = React.useMemo(() => new Set((isAdmin ? ALL_PERMISSIONS : (role?.permissions ?? [])) as Permission[]), [role, isAdmin])
  const extra = new Set(v.extraPermissions)
  const revoked = new Set(v.revokedPermissions)
  const isOn = (p: Permission) => isAdmin || (rolePerms.has(p) ? !revoked.has(p) : extra.has(p))
  const effectiveCount = ALL_PERMISSIONS.filter(isOn).length

  const toggle = (p: Permission, on: boolean) =>
    setV((prev) => {
      const ex = new Set(prev.extraPermissions)
      const rv = new Set(prev.revokedPermissions)
      if (rolePerms.has(p)) {
        if (on) rv.delete(p)
        else rv.add(p)
      } else if (on) ex.add(p)
      else ex.delete(p)
      return { ...prev, extraPermissions: [...ex], revokedPermissions: [...rv] }
    })

  const changeRole = (roleId: number) =>
    setV((prev) => {
      const next = roles.find((r) => r.id === roleId)
      const perms = new Set(next?.permissions ?? [])
      // نفس قاعدة الخادم: المضافة خارج الدور فقط، والمحجوبة من داخله فقط
      return {
        ...prev,
        roleId,
        extraPermissions: prev.extraPermissions.filter((p) => !perms.has(p)),
        revokedPermissions: prev.revokedPermissions.filter((p) => perms.has(p)),
      }
    })

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="البيانات والدور" />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="الاسم الكامل" required error={fieldErrors.fullName}>
            <Input value={v.fullName} onChange={(e) => setV((p) => ({ ...p, fullName: e.target.value }))} />
          </Field>
          <Field label="اسم المستخدم" hint="لا يتغير بعد الإنشاء">
            <Input value={v.username} disabled dir="ltr" className="text-start" />
          </Field>
          <Field label="الدور" required error={fieldErrors.roleId} hint={role?.description ?? undefined}>
            <Select value={v.roleId} onChange={(e) => changeRole(Number(e.target.value))}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الهاتف" error={fieldErrors.phone}>
            <Input value={v.phone} onChange={(e) => setV((p) => ({ ...p, phone: e.target.value }))} dir="ltr" className="text-start" inputMode="tel" />
          </Field>
          <Field label="البريد الإلكتروني" error={fieldErrors.email}>
            <Input value={v.email} onChange={(e) => setV((p) => ({ ...p, email: e.target.value }))} dir="ltr" className="text-start" />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              checked={v.isActive}
              disabled={isSelf}
              onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))}
              label="حساب فعّال"
              description={isSelf ? 'لا يمكنك تعطيل حسابك' : 'التعطيل يمنع الدخول وينهي الجلسات فورًا'}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand-600" />
              الصلاحيات الفعلية
              <span className="num text-sm font-normal text-slate-500">
                ({effectiveCount} من {ALL_PERMISSIONS.length})
              </span>
            </span>
          }
          description={
            isAdmin
              ? 'مدير النظام يملك كل الصلاحيات دائمًا.'
              : 'الأساس صلاحيات الدور. فعّل صلاحية خارج الدور لإضافتها لهذا المستخدم فقط، أو ألغِ صلاحية من الدور لحجبها عنه.'
          }
        />
        <CardBody>
          <PermissionMatrix
            isOn={isOn}
            onToggle={toggle}
            disabled={isAdmin}
            tag={(p) => (isAdmin ? null : extra.has(p) && !rolePerms.has(p) ? { label: 'مضافة', tone: 'add' } : revoked.has(p) && rolePerms.has(p) ? { label: 'محجوبة', tone: 'remove' } : null)}
          />
        </CardBody>
      </Card>
      <div className="sticky bottom-3 z-10 flex justify-end">
        <Button size="lg" loading={pending} className="shadow-lg" onClick={() => run({ ...v, id: user.id })}>
          {!pending ? <Save /> : null}
          حفظ التغييرات
        </Button>
      </div>
    </div>
  )
}
