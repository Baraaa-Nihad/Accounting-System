'use client'

import * as React from 'react'
import Link from 'next/link'
import { Coins, Undo2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { applyCreditAction } from '@/app/(app)/receipts/actions'

/** رصيد دائن غير مستخدم للطالب: تطبيقه على الذمم المفتوحة أو إرجاعه لولي الأمر. */
export function StudentCreditBanner({ studentId, credit, hasOpen }: { studentId: number; credit: string; hasOpen: boolean }) {
  const can = useCan()
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const apply = useAction(applyCreditAction, { onSuccess: () => setOpen(false) })
  return (
    <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5">
      <p className="flex items-center gap-2 text-emerald-900">
        <Coins className="size-5" />
        للطالب رصيد دائن غير مستخدم: <b>{f.money(credit)}</b>
      </p>
      <div className="flex flex-wrap gap-2">
        {hasOpen && (can('receipts.create') || can('receipts.edit')) ? (
          <Button variant="success" size="sm" onClick={() => setOpen(true)}>
            <Wand2 />
            تطبيقه على الذمم المستحقة
          </Button>
        ) : null}
        {can('vouchers.create') ? (
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/vouchers/new?kind=STUDENT_REFUND&studentId=${studentId}`}>
              <Undo2 />
              إرجاع المبلغ لولي الأمر
            </Link>
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="تطبيق الرصيد الدائن"
        description="يُوزع الرصيد على الأقساط المفتوحة من الأقدم استحقاقًا. لا يتغير رصيد الطالب الإجمالي ولا الصندوق، فقط تُسدد الأقساط من الرصيد."
        confirmLabel="تطبيق"
        pending={apply.pending}
        onConfirm={() => apply.run({ studentId })}
      />
    </div>
  )
}
