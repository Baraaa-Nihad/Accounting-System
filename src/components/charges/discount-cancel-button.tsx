'use client'

import * as React from 'react'
import { Ban } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { cancelDiscountAction } from '@/app/(app)/charges/actions'

export function DiscountCancelButton({ discountId }: { discountId: number }) {
  const [open, setOpen] = React.useState(false)
  const { run, pending } = useAction(cancelDiscountAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="إلغاء الخصم">
        <Ban className="size-4" />
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="إلغاء الخصم"
        description="يعود مبلغ الخصم على الطالب ويُعاد توزيعه على الأقساط غير المدفوعة، ويُعكس القيد."
        confirmLabel="إلغاء الخصم"
        danger
        requireReason
        pending={pending}
        onConfirm={(reason) => run({ id: discountId, reason })}
      />
    </>
  )
}
