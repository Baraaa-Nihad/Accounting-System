'use client'

import * as React from 'react'
import { KeyRound, LogOut, RefreshCw, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { endUserSessionsAction, resetPasswordAction, unlockUserAction } from '@/app/(app)/users/actions'
import { randomPassword } from './permission-matrix'

/** إعادة تعيين كلمة المرور بكلمة مؤقتة (يُطلب تغييرها عند الدخول). */
export function ResetPasswordDialog({ userId, username }: { userId: number; username: string }) {
  const [open, setOpen] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const { run, pending, fieldErrors } = useAction(resetPasswordAction, { onSuccess: () => setOpen(false) })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setPassword(randomPassword())
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <KeyRound />
          إعادة تعيين كلمة المرور
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`كلمة مرور مؤقتة لـ ${username}`}
        description="ستُنهى كل جلسات المستخدم، وسيُطلب منه تعيين كلمة مرور جديدة عند الدخول."
        size="sm"
        footer={
          <Button loading={pending} onClick={() => run({ id: userId, password })}>
            تعيين
          </Button>
        }
      >
        <Field label="كلمة المرور المؤقتة" required error={fieldErrors.password} hint="انسخها وسلّمها للمستخدم قبل الإغلاق">
          <div className="flex gap-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="num text-start" autoComplete="off" />
            <Button variant="secondary" size="icon" aria-label="توليد كلمة مرور" onClick={() => setPassword(randomPassword())}>
              <RefreshCw />
            </Button>
          </div>
        </Field>
      </DialogContent>
    </Dialog>
  )
}

export function UnlockButton({ userId }: { userId: number }) {
  const { run, pending } = useAction(unlockUserAction)
  return (
    <Button variant="soft" loading={pending} onClick={() => run(userId)}>
      {!pending ? <Unlock /> : null}
      فك القفل
    </Button>
  )
}

/** إنهاء كل جلسات المستخدم أو جلسة واحدة. */
export function EndSessionsButton({ userId, sessionId, label = 'إنهاء كل الجلسات' }: { userId: number; sessionId?: string; label?: string }) {
  const [open, setOpen] = React.useState(false)
  const { run, pending } = useAction(endUserSessionsAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button variant={sessionId ? 'ghost' : 'danger-outline'} size={sessionId ? 'sm' : 'md'} onClick={() => setOpen(true)}>
        <LogOut />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={sessionId ? 'إنهاء هذه الجلسة؟' : 'إنهاء كل جلسات المستخدم؟'}
        description="سيُطلب من المستخدم تسجيل الدخول من جديد على الأجهزة المعنية."
        confirmLabel="إنهاء"
        danger
        pending={pending}
        onConfirm={() => run({ userId, sessionId: sessionId ?? null })}
      />
    </>
  )
}
