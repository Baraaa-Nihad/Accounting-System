'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { reverseManualEntryAction } from '@/app/(app)/accounting/actions'

/** عكس قيد يدوي بقيد عكسي مؤرخ (لا حذف). */
export function ReverseEntryButton({ entryId, number }: { entryId: number; number: string }) {
  const router = useRouter()
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState(today)
  const { run, pending } = useAction(reverseManualEntryAction, { onSuccess: (d) => { setOpen(false); router.push(`/accounting/journal/${d.id}`) } })
  return (
    <>
      <Button variant="danger-outline" onClick={() => setOpen(true)}>
        <Undo2 />
        عكس القيد
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`عكس القيد ${number}؟`}
        description="يُنشأ قيد عكسي مطابق بتاريخ العكس، ويبقى القيد الأصلي ظاهرًا مع علامة «معكوس»."
        confirmLabel="عكس القيد"
        danger
        requireReason
        reasonLabel="سبب العكس"
        pending={pending}
        onConfirm={(reason) => run({ id: entryId, date, reason })}
      >
        <Field label="تاريخ العكس" className="mb-4">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  )
}
