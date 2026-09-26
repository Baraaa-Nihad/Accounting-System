'use client'

import * as React from 'react'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import type { ActionResult } from '@/server/errors'

/** زر إلغاء مستند (سند، تحويل، فاتورة) مع سبب إجباري؛ المستند يبقى محفوظًا بحالة «ملغي». */
export function CancelDocButton({
  id,
  action,
  title,
  description,
  label = 'إلغاء',
  size = 'md',
  iconOnly,
}: {
  id: number
  action: (input: { id: number; reason: string }) => Promise<ActionResult<null>>
  title: string
  description: React.ReactNode
  label?: string
  size?: 'sm' | 'md'
  iconOnly?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const { run, pending } = useAction(action, { onSuccess: () => setOpen(false) })
  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={label} title={label}>
          <Ban className="size-4" />
        </button>
      ) : (
        <Button variant="danger-outline" size={size} onClick={() => setOpen(true)}>
          <Ban />
          {label}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={label}
        danger
        requireReason
        pending={pending}
        onConfirm={(reason) => run({ id, reason })}
      />
    </>
  )
}
