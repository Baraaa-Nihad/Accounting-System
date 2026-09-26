'use client'

import * as React from 'react'
import Link from 'next/link'
import { MoreVertical, Banknote, PencilLine, CheckCheck, RotateCcw, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { useApp, useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { adjustJobAction, setJobStatusAction } from '@/app/(app)/contractors/actions'

export function JobActions({ job }: { job: { id: number; description: string; agreed: string; paid: string; remaining: string; status: string } }) {
  const can = useCan()
  const f = useFormat()
  const { today } = useApp()
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [adj, setAdj] = React.useState({ newAmount: job.agreed, reason: '', date: today })
  const adjust = useAction(adjustJobAction, { onSuccess: () => setAdjustOpen(false) })
  const status = useAction(setJobStatusAction, { onSuccess: () => setCancelOpen(false) })
  const manage = can('contractors.manage')
  if (job.status === 'CANCELLED') return null
  return (
    <>
      <Dropdown dir="rtl">
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="إجراءات">
            <MoreVertical />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          {can('vouchers.create') && Number(job.remaining) > 0 ? (
            <DropdownItem asChild>
              <Link href={`/vouchers/new?kind=CONTRACTOR_PAYMENT&jobId=${job.id}`}>
                <Banknote />
                صرف دفعة
              </Link>
            </DropdownItem>
          ) : null}
          {manage ? (
            <>
              <DropdownItem onSelect={() => { setAdj({ newAmount: job.agreed, reason: '', date: today }); setAdjustOpen(true) }}>
                <PencilLine />
                تعديل قيمة الاتفاق
              </DropdownItem>
              {job.status === 'OPEN' ? (
                <DropdownItem onSelect={() => status.run({ id: job.id, status: 'COMPLETED' })}>
                  <CheckCheck />
                  تم إنجاز العمل
                </DropdownItem>
              ) : (
                <DropdownItem onSelect={() => status.run({ id: job.id, status: 'OPEN' })}>
                  <RotateCcw />
                  إعادة فتح
                </DropdownItem>
              )}
              <DropdownItem onSelect={() => setCancelOpen(true)} danger>
                <Ban />
                إلغاء العمل
              </DropdownItem>
            </>
          ) : null}
        </DropdownContent>
      </Dropdown>
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent
          title="تعديل قيمة الاتفاق"
          description={`«${job.description}» — القيمة الحالية ${f.moneyText(job.agreed)}، المدفوع ${f.moneyText(job.paid)}. يُسجل قيد بالفرق.`}
          size="sm"
          footer={
            <Button loading={adjust.pending} onClick={() => adjust.run({ id: job.id, ...adj })}>
              حفظ التعديل
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="القيمة الجديدة" required error={adjust.fieldErrors.newAmount}>
              <MoneyInput value={adj.newAmount} onChange={(x) => setAdj((p) => ({ ...p, newAmount: x }))} />
            </Field>
            <Field label="سبب التعديل" required error={adjust.fieldErrors.reason}>
              <Input value={adj.reason} onChange={(e) => setAdj((p) => ({ ...p, reason: e.target.value }))} placeholder="مثال: أعمال إضافية" />
            </Field>
            <Field label="تاريخ التعديل" required>
              <Input type="date" value={adj.date} onChange={(e) => setAdj((p) => ({ ...p, date: e.target.value }))} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="إلغاء العمل"
        description={
          Number(job.paid) > 0
            ? `دُفع لهذا العمل ${f.moneyText(job.paid)}. سيُلغى الجزء غير المدفوع فقط (${f.moneyText(job.remaining)}) وتبقى الدفعات كما هي.`
            : 'يُعكس قيد الاتفاق بالكامل ويبقى العمل ظاهرًا بحالة «ملغي».'
        }
        confirmLabel="إلغاء العمل"
        danger
        requireReason
        pending={status.pending}
        onConfirm={(reason) => status.run({ id: job.id, status: 'CANCELLED', reason })}
      />
    </>
  )
}
