'use client'

import * as React from 'react'
import Link from 'next/link'
import { Printer, Ban, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { cancelReceiptAction, reallocateReceiptAction } from '@/app/(app)/receipts/actions'
import { D, sum } from '@/lib/money'

export interface ReallocRow {
  installmentId: number
  studentId: number
  studentName: string
  label: string
  dueDate: string
  available: string
  current: string
}

export function ReceiptActions({
  receiptId,
  cancelled,
  hasCheque,
  realloc,
  shares,
}: {
  receiptId: number
  cancelled: boolean
  hasCheque: boolean
  realloc: ReallocRow[] | null
  shares: { studentId: number; studentName: string; share: string }[]
}) {
  const can = useCan()
  const f = useFormat()
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [reOpen, setReOpen] = React.useState(false)
  const [values, setValues] = React.useState<Record<number, string>>(() =>
    Object.fromEntries((realloc ?? []).map((r) => [r.installmentId, D(r.current).greaterThan(0) ? r.current : ''])),
  )
  const cancel = useAction(cancelReceiptAction, { onSuccess: () => setCancelOpen(false) })
  const re = useAction(reallocateReceiptAction, { onSuccess: () => setReOpen(false) })

  const perStudent = new Map<number, ReturnType<typeof D>>()
  for (const r of realloc ?? []) perStudent.set(r.studentId, (perStudent.get(r.studentId) ?? D(0)).plus(D(values[r.installmentId] || '0')))
  const overShare = shares.some((s) => (perStudent.get(s.studentId) ?? D(0)).greaterThan(D(s.share)))

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={`/print/receipts/${receiptId}`} target="_blank">
          <Printer />
          طباعة
        </Link>
      </Button>
      {!cancelled && realloc && can('receipts.edit') ? (
        <Button variant="secondary" onClick={() => setReOpen(true)}>
          <Shuffle />
          تعديل توزيع الدفعة
        </Button>
      ) : null}
      {!cancelled && can('receipts.cancel') ? (
        <Button variant="danger-outline" onClick={() => setCancelOpen(true)}>
          <Ban />
          إلغاء السند
        </Button>
      ) : null}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="إلغاء سند القبض"
        description="يبقى السند محفوظًا بحالة «ملغي» مع رقمه، ويُعكس قيده، وتعود المبالغ على الطالب."
        confirmLabel="إلغاء السند"
        danger
        requireReason
        pending={cancel.pending}
        onConfirm={(reason) => cancel.run({ id: receiptId, reason })}
      >
        {hasCheque ? <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">لتسجيل شيك مرتجع استخدم صفحة «الشيكات» حتى يُسجل الشيك بحالة «مرتجع».</p> : null}
      </ConfirmDialog>
      {realloc ? (
        <Dialog open={reOpen} onOpenChange={setReOpen}>
          <DialogContent
            title="تعديل توزيع الدفعة"
            description="وزّع مبلغ السند على ذمم أخرى. ما لا يُوزع يبقى رصيدًا دائنًا للطالب. لا يتغير مبلغ السند ولا قيده."
            size="lg"
            footer={
              <>
                <Button variant="secondary" onClick={() => setReOpen(false)}>
                  إلغاء
                </Button>
                <Button
                  loading={re.pending}
                  disabled={overShare}
                  onClick={() =>
                    re.run({
                      receiptId,
                      allocations: Object.entries(values)
                        .filter(([, v]) => v && D(v).greaterThan(0))
                        .map(([id, v]) => ({ installmentId: Number(id), amount: v })),
                    })
                  }
                >
                  حفظ التوزيع
                </Button>
              </>
            }
          >
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {shares.map((s) => (
                <span key={s.studentId}>
                  {shares.length > 1 ? `${s.studentName}: ` : 'حصة الطالب: '}
                  <b>{f.money(s.share)}</b> — الموزع {f.money(perStudent.get(s.studentId) ?? 0)}
                </span>
              ))}
            </div>
            {overShare ? <p className="mb-2 text-sm text-rose-600">التوزيع أكبر من حصة الطالب من السند</p> : null}
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {shares.length > 1 ? <th className="px-2 py-2 text-start">الطالب</th> : null}
                  <th className="px-2 py-2 text-start">الذمة</th>
                  <th className="px-2 py-2 text-start">الاستحقاق</th>
                  <th className="px-2 py-2 text-end">المتاح</th>
                  <th className="px-2 py-2 text-end">التوزيع</th>
                </tr>
              </thead>
              <tbody>
                {realloc.map((r) => (
                  <tr key={r.installmentId} className="border-t border-slate-100">
                    {shares.length > 1 ? <td className="px-2 py-1.5">{r.studentName}</td> : null}
                    <td className="px-2 py-1.5">{r.label}</td>
                    <td className="px-2 py-1.5">{f.date(r.dueDate)}</td>
                    <td className="px-2 py-1.5 text-end">{f.money(r.available)}</td>
                    <td className="w-32 px-2 py-1.5">
                      <Input
                        value={values[r.installmentId] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [r.installmentId]: e.target.value.replace(/[^\d.]/g, '') }))}
                        dir="ltr"
                        className="num h-8 text-left"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">مجموع التوزيع: {f.money(sum(Object.values(values).map((v) => v || '0')))}</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
