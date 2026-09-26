'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { changePasswordAction } from './actions'

export function ChangePasswordForm() {
  const [values, setValues] = useState({ current: '', next: '', confirm: '' })
  const router = useRouter()
  const { run, pending, fieldErrors } = useAction(changePasswordAction, {
    refresh: false,
    onSuccess: () => router.replace('/'),
  })
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }))
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(values)
      }}
    >
      <Field label="كلمة المرور الحالية" error={fieldErrors.current}>
        <Input type="password" value={values.current} onChange={set('current')} autoComplete="current-password" dir="ltr" required />
      </Field>
      <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل، وتحتوي على أحرف وأرقام" error={fieldErrors.next}>
        <Input type="password" value={values.next} onChange={set('next')} autoComplete="new-password" dir="ltr" required />
      </Field>
      <Field label="تأكيد كلمة المرور الجديدة" error={fieldErrors.confirm}>
        <Input type="password" value={values.confirm} onChange={set('confirm')} autoComplete="new-password" dir="ltr" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {!pending ? <KeyRound /> : null}
        حفظ كلمة المرور
      </Button>
    </form>
  )
}
