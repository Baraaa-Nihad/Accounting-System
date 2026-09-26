'use client'

import * as React from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { closeYearAction, reopenYearAction } from '@/app/(app)/settings/actions'

/** خيارات الإغلاق + تأكيد بكتابة اسم السنة (عملية حساسة). */
export function CloseYearPanel({ yearId, yearName, canDistribute, canMoveCurrent, nextName }: { yearId: number; yearName: string; canDistribute: boolean; canMoveCurrent: boolean; nextName: string | null }) {
  const [distribute, setDistribute] = React.useState(canDistribute)
  const [moveCurrent, setMoveCurrent] = React.useState(canMoveCurrent)
  const [open, setOpen] = React.useState(false)
  const [typed, setTyped] = React.useState('')
  const { run, pending } = useAction(closeYearAction, { onSuccess: () => setOpen(false) })
  return (
    <div className="space-y-3">
      {canDistribute ? (
        <Checkbox checked={distribute} onChange={(e) => setDistribute(e.target.checked)} label="توزيع صافي النتيجة على جاري الشركاء حسب نسب الملكية" description="وإلا تبقى كاملة في الأرباح المحتجزة" />
      ) : null}
      {canMoveCurrent && nextName ? (
        <Checkbox checked={moveCurrent} onChange={(e) => setMoveCurrent(e.target.checked)} label={`تعيين ${nextName} سنة حالية بعد الإغلاق`} />
      ) : null}
      <Button variant="danger" size="lg" onClick={() => setOpen(true)}>
        <Lock />
        إغلاق السنة {yearName}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setTyped('')
        }}
        title={`إغلاق السنة ${yearName}؟`}
        description="سيُرحّل قيد الإقفال، وتُمنع أي حركة جديدة أو تعديل بتاريخ داخل هذه السنة. الذمم غير المسددة تبقى على الطلاب وتُحصّل في السنة الجديدة."
        confirmLabel="إغلاق السنة"
        danger
        pending={pending}
        disabled={typed.trim() !== yearName}
        onConfirm={() => run({ yearId, distribute, makeNextCurrent: moveCurrent })}
      >
        <Field label={`للتأكيد اكتب اسم السنة: ${yearName}`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" className="num text-start" autoFocus />
        </Field>
      </ConfirmDialog>
    </div>
  )
}

export function ReopenYearButton({ yearId, yearName }: { yearId: number; yearName: string }) {
  const [open, setOpen] = React.useState(false)
  const { run, pending } = useAction(reopenYearAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button variant="danger-outline" onClick={() => setOpen(true)}>
        <LockOpen />
        إعادة فتح السنة
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`إعادة فتح السنة ${yearName}؟`}
        description="تُعكس قيود الإقفال بنفس تاريخها وتعود السنة قابلة للحركات. عملية حساسة تُسجل في سجل النشاط."
        confirmLabel="إعادة الفتح"
        danger
        requireReason
        reasonLabel="سبب إعادة الفتح"
        pending={pending}
        onConfirm={(reason) => run({ yearId, reason })}
      />
    </>
  )
}
