'use client'

import * as React from 'react'
import Link from 'next/link'
import { RefreshCw, BadgeCheck, Ban, Banknote, Printer, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp, useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { addEmployeeToRunAction, approveRunAction, cancelRunAction, payRunAction, recalcRunAction } from '@/app/(app)/payroll/actions'
import { PAYMENT_METHOD } from '@/lib/labels'
import { D } from '@/lib/money'

export function RunActions({
  run,
  cashAccounts,
  missingEmployees,
}: {
  run: { id: number; status: string; label: string; totalNet: string; totalPaid: string }
  cashAccounts: { id: number; name: string; type: string; balance: string; isDefault: boolean }[]
  missingEmployees: { id: number; fullName: string }[]
}) {
  const can = useCan()
  const f = useFormat()
  const { today } = useApp()
  const [approveOpen, setApproveOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [payOpen, setPayOpen] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [addId, setAddId] = React.useState('')
  const defaultCash = cashAccounts.find((c) => c.isDefault && c.type === 'BANK') ?? cashAccounts.find((c) => c.isDefault) ?? cashAccounts[0]
  const [pay, setPay] = React.useState({ date: today, cashAccountId: String(defaultCash?.id ?? ''), paymentMethod: 'BANK_TRANSFER', referenceNumber: '' })
  const recalc = useAction(recalcRunAction)
  const approve = useAction(approveRunAction, { onSuccess: () => setApproveOpen(false) })
  const cancel = useAction(cancelRunAction, { onSuccess: () => setCancelOpen(false) })
  const payAll = useAction(payRunAction, { onSuccess: () => setPayOpen(false) })
  const add = useAction(addEmployeeToRunAction, { onSuccess: () => setAddOpen(false) })
  const remaining = D(run.totalNet).minus(D(run.totalPaid))
  const cash = cashAccounts.find((c) => String(c.id) === pay.cashAccountId)
  const manage = can('payroll.manage')

  return (
    <div className="flex flex-wrap gap-2">
      {run.status === 'DRAFT' && manage ? (
        <>
          {missingEmployees.length > 0 ? (
            <Button variant="ghost" onClick={() => setAddOpen(true)}>
              <UserPlus />
              إضافة موظف
            </Button>
          ) : null}
          <Button variant="secondary" loading={recalc.pending} onClick={() => recalc.run(run.id)}>
            {!recalc.pending ? <RefreshCw /> : null}
            إعادة الاحتساب
          </Button>
          <Button variant="success" size="lg" onClick={() => setApproveOpen(true)}>
            <BadgeCheck />
            اعتماد المسير
          </Button>
        </>
      ) : null}
      {run.status === 'APPROVED' ? (
        <>
          <Button variant="secondary" asChild>
            <Link href={`/print/payroll/${run.id}`} target="_blank">
              <Printer />
              طباعة الكشف
            </Link>
          </Button>
          {remaining.greaterThan(0) && can('payroll.pay') && can('vouchers.create') ? (
            <Button size="lg" onClick={() => setPayOpen(true)}>
              <Banknote />
              صرف الرواتب ({f.moneyText(remaining)})
            </Button>
          ) : null}
        </>
      ) : null}
      {run.status !== 'CANCELLED' && manage ? (
        <Button variant="danger-outline" onClick={() => setCancelOpen(true)} disabled={run.status === 'APPROVED' && D(run.totalPaid).greaterThan(0)} title={run.status === 'APPROVED' && D(run.totalPaid).greaterThan(0) ? 'صُرفت رواتب من المسير؛ ألغِ سندات الصرف أولًا' : undefined}>
          <Ban />
          {run.status === 'DRAFT' ? 'إلغاء المسودة' : 'إلغاء المسير'}
        </Button>
      ) : null}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`اعتماد مسير رواتب ${run.label}`}
        description={
          <>
            سيُقفل المسير ويُسجل قيد الرواتب بصافي <b>{f.moneyText(run.totalNet)}</b> مستحقًا للموظفين، وتُخصم أقساط السلف وتُربط الساعات الإضافية. بعد الاعتماد يمكن صرف الرواتب.
          </>
        }
        confirmLabel="اعتماد"
        pending={approve.pending}
        onConfirm={() => approve.run(run.id)}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={run.status === 'DRAFT' ? 'إلغاء المسودة' : `إلغاء مسير ${run.label}`}
        description={
          run.status === 'DRAFT'
            ? 'تُلغى المسودة وتعود الساعات الإضافية معلّقة. يمكنك احتساب الشهر من جديد.'
            : 'يُعكس قيد الرواتب، وتعود أقساط السلف والساعات الإضافية معلّقة. يبقى المسير ظاهرًا بحالة «ملغي».'
        }
        confirmLabel="إلغاء"
        danger
        requireReason
        pending={cancel.pending}
        onConfirm={(reason) => cancel.run({ id: run.id, reason })}
      />
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent
          title={`صرف رواتب ${run.label}`}
          description="يُنشأ سند صرف «راتب» لكل موظف بالمتبقي من صافي راتبه. للصرف الجزئي أو بشيك استخدم زر الصرف بجانب الموظف."
          size="sm"
          footer={
            <Button
              loading={payAll.pending}
              disabled={!!cash && remaining.greaterThan(D(cash.balance))}
              onClick={() => payAll.run({ runId: run.id, date: pay.date, cashAccountId: pay.cashAccountId, paymentMethod: pay.paymentMethod, referenceNumber: pay.referenceNumber })}
            >
              صرف {f.moneyText(remaining)}
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="تاريخ الصرف" required error={payAll.fieldErrors.date}>
              <Input type="date" value={pay.date} onChange={(e) => setPay((p) => ({ ...p, date: e.target.value }))} />
            </Field>
            <Field label="الطريقة">
              <Select value={pay.paymentMethod} onChange={(e) => setPay((p) => ({ ...p, paymentMethod: e.target.value }))}>
                {Object.entries(PAYMENT_METHOD)
                  .filter(([k]) => k !== 'CHEQUE')
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              label="يُصرف من"
              required
              hint={cash ? <>الرصيد المتاح: {f.money(cash.balance)}</> : undefined}
              error={cash && remaining.greaterThan(D(cash.balance)) ? 'الرصيد لا يكفي لصرف كل الرواتب' : payAll.fieldErrors.cashAccountId}
            >
              <Select value={pay.cashAccountId} onChange={(e) => setPay((p) => ({ ...p, cashAccountId: e.target.value }))}>
                {cashAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {pay.paymentMethod !== 'CASH' ? (
              <Field label="رقم المرجع / الحوالة">
                <Input value={pay.referenceNumber} onChange={(e) => setPay((p) => ({ ...p, referenceNumber: e.target.value }))} dir="ltr" className="text-start" />
              </Field>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          title="إضافة موظف إلى المسودة"
          size="sm"
          footer={
            <Button loading={add.pending} disabled={!addId} onClick={() => add.run({ runId: run.id, employeeId: Number(addId) })}>
              إضافة
            </Button>
          }
        >
          <Field label="الموظف">
            <Select value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">اختر</option>
              {missingEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </DialogContent>
      </Dialog>
    </div>
  )
}
