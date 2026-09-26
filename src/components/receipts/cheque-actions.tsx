'use client'

import * as React from 'react'
import { CheckCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { bounceChequeAction, clearChequeAction } from '@/app/(app)/receipts/actions'

export function ChequeActions({ chequeId, banks }: { chequeId: number; banks: { id: number; name: string }[] }) {
  const { today } = useApp()
  const [clearOpen, setClearOpen] = React.useState(false)
  const [bounceOpen, setBounceOpen] = React.useState(false)
  const [bank, setBank] = React.useState(String(banks[0]?.id ?? ''))
  const [date, setDate] = React.useState(today)
  const clear = useAction(clearChequeAction, { onSuccess: () => setClearOpen(false) })
  const bounce = useAction(bounceChequeAction, { onSuccess: () => setBounceOpen(false) })
  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="soft" onClick={() => setClearOpen(true)} disabled={banks.length === 0} title={banks.length ? '' : 'أضف حسابًا بنكيًا أولًا'}>
        <CheckCheck />
        تحصيل
      </Button>
      <Button size="sm" variant="danger-outline" onClick={() => setBounceOpen(true)}>
        <Undo2 />
        مرتجع
      </Button>
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent
          title="تحصيل الشيك"
          description="ينتقل المبلغ من حافظة الشيكات إلى الحساب البنكي."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setClearOpen(false)}>
                إلغاء
              </Button>
              <Button loading={clear.pending} onClick={() => clear.run({ chequeId, bankAccountId: bank, date })}>
                تأكيد التحصيل
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="أُودع في الحساب البنكي">
              <Select value={bank} onChange={(e) => setBank(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ التحصيل">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={bounceOpen}
        onOpenChange={setBounceOpen}
        title="تسجيل شيك مرتجع"
        description="سيُلغى سند القبض المرتبط تلقائيًا، وتعود المبالغ على الطالب، ويأخذ الشيك حالة «مرتجع»."
        confirmLabel="تسجيل الإرجاع"
        danger
        requireReason
        reasonLabel="سبب الإرجاع (مثل: رصيد غير كافٍ)"
        pending={bounce.pending}
        onConfirm={(reason) => bounce.run({ chequeId, reason })}
      />
    </div>
  )
}
