'use client'

import { useActionState } from 'react'
import { LogIn, AlertCircle } from 'lucide-react'
import { loginAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null)
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      <Field label="اسم المستخدم" htmlFor="username">
        <Input id="username" name="username" autoComplete="username" autoFocus required dir="ltr" className="text-start" />
      </Field>
      <Field label="كلمة المرور" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" className="text-start" />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {!pending ? <LogIn /> : null}
        دخول
      </Button>
    </form>
  )
}
