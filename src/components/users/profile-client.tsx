'use client'

import * as React from 'react'
import { LogOut, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { endMySessionsAction, updateProfileAction } from '@/app/(app)/profile/actions'

export function ProfileForm({ initial }: { initial: { fullName: string; email: string; phone: string } }) {
  const [v, setV] = React.useState(initial)
  const { run, pending, fieldErrors } = useAction(updateProfileAction)
  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        run(v)
      }}
    >
      <Field label="الاسم الكامل" required error={fieldErrors.fullName}>
        <Input value={v.fullName} onChange={(e) => setV((p) => ({ ...p, fullName: e.target.value }))} />
      </Field>
      <Field label="الهاتف" error={fieldErrors.phone}>
        <Input value={v.phone} onChange={(e) => setV((p) => ({ ...p, phone: e.target.value }))} dir="ltr" className="text-start" inputMode="tel" />
      </Field>
      <Field label="البريد الإلكتروني" error={fieldErrors.email}>
        <Input value={v.email} onChange={(e) => setV((p) => ({ ...p, email: e.target.value }))} dir="ltr" className="text-start" />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" loading={pending}>
          {!pending ? <Save /> : null}
          حفظ بياناتي
        </Button>
      </div>
    </form>
  )
}

/** إنهاء جلسة واحدة أو كل الجلسات الأخرى (غير الجلسة الحالية). */
export function EndMySessionsButton({ sessionId, label }: { sessionId?: string; label: string }) {
  const { run, pending } = useAction(endMySessionsAction)
  return (
    <Button variant={sessionId ? 'ghost' : 'danger-outline'} size="sm" loading={pending} onClick={() => run(sessionId ?? null)}>
      {!pending ? <LogOut /> : null}
      {label}
    </Button>
  )
}
