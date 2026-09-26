'use client'

import * as React from 'react'
import { Dialog, DialogContent } from './dialog'
import { Button } from './button'
import { Textarea } from './input'
import { Field } from './field'

/** نافذة تأكيد للعمليات الحساسة، مع حقل «السبب» الإجباري عند الإلغاء. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'تأكيد',
  danger,
  requireReason,
  reasonLabel = 'السبب',
  pending,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  requireReason?: boolean
  reasonLabel?: string
  pending?: boolean
  onConfirm: (reason: string) => void
  children?: React.ReactNode
}) {
  const [reason, setReason] = React.useState('')
  const invalid = requireReason && reason.trim().length < 3
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('')
        onOpenChange(o)
      }}
    >
      <DialogContent
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              تراجع
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} disabled={invalid} loading={pending} onClick={() => onConfirm(reason.trim())}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
        {requireReason ? (
          <Field label={reasonLabel} required hint="يُحفظ السبب في سجل النشاط ويظهر على المستند">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </Field>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
