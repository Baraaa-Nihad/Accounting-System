'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, Printer, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createOtherReceiptAction } from '@/app/(app)/receipts/actions'
import { PAYMENT_METHOD } from '@/lib/labels'

export function OtherReceiptForm({
  kind,
  revenueAccounts,
  partners,
  cashAccounts,
}: {
  kind: 'OTHER_REVENUE' | 'PARTNER_CAPITAL'
  revenueAccounts: { id: number; name: string; code: string }[]
  partners: { id: number; name: string }[]
  cashAccounts: { id: number; name: string; type: string; isDefault: boolean }[]
}) {
  const { today } = useApp()
  const f = useFormat()
  const [v, setV] = React.useState({
    payerName: '',
    amount: '',
    date: today,
    paymentMethod: 'CASH',
    cashAccountId: String(cashAccounts.find((c) => c.isDefault)?.id ?? cashAccounts[0]?.id ?? ''),
    revenueAccountId: '',
    partnerId: '',
    description: '',
    notes: '',
    referenceNumber: '',
    chequeNumber: '',
    chequeBank: '',
    chequeDue: today,
  })
  const [done, setDone] = React.useState<{ id: number; number: string } | null>(null)
  const { run, pending, fieldErrors } = useAction(createOtherReceiptAction, { onSuccess: setDone })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }))

  if (done) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <CheckCircle2 className="mb-3 size-12 text-emerald-600" />
        <p className="text-lg font-bold">تم حفظ سند القبض</p>
        <p className="num text-2xl font-bold text-brand-700">{done.number}</p>
        <div className="mt-5 flex gap-2">
          <Button asChild>
            <Link href={`/print/receipts/${done.id}?auto=1`} target="_blank">
              <Printer />
              طباعة
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => { setDone(null); setV((p) => ({ ...p, amount: '', payerName: '', description: '' })) }}>
            سند جديد
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        run({
          kind,
          payerName: kind === 'PARTNER_CAPITAL' ? partners.find((p) => String(p.id) === v.partnerId)?.name ?? v.payerName : v.payerName,
          amount: v.amount,
          date: v.date,
          paymentMethod: v.paymentMethod,
          cashAccountId: v.paymentMethod === 'CHEQUE' ? null : v.cashAccountId,
          cheque: v.paymentMethod === 'CHEQUE' ? { number: v.chequeNumber, bankName: v.chequeBank, dueDate: v.chequeDue } : null,
          revenueAccountId: kind === 'OTHER_REVENUE' ? v.revenueAccountId : null,
          partnerId: kind === 'PARTNER_CAPITAL' ? v.partnerId : null,
          description: v.description,
          notes: v.notes,
          referenceNumber: v.referenceNumber,
        })
      }}
    >
      {kind === 'OTHER_REVENUE' ? (
        <>
          <Field label="تصنيف الإيراد" required error={fieldErrors.revenueAccountId}>
            <Select value={v.revenueAccountId} onChange={set('revenueAccountId')}>
              <option value="">اختر التصنيف</option>
              {revenueAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="اسم الدافع / المتبرع" required error={fieldErrors.payerName}>
            <Input value={v.payerName} onChange={set('payerName')} />
          </Field>
        </>
      ) : (
        <Field label="الشريك" required error={fieldErrors.partnerId} className="sm:col-span-2">
          <Select value={v.partnerId} onChange={set('partnerId')}>
            <option value="">اختر الشريك</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="المبلغ" required error={fieldErrors.amount}>
        <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} />
      </Field>
      <Field label="التاريخ" required error={fieldErrors.date}>
        <Input type="date" value={v.date} onChange={set('date')} />
      </Field>
      <Field label="طريقة الدفع">
        <Select value={v.paymentMethod} onChange={set('paymentMethod')}>
          {Object.entries(PAYMENT_METHOD).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      {v.paymentMethod === 'CHEQUE' ? (
        <>
          <Field label="رقم الشيك" required error={fieldErrors['cheque.number']}>
            <Input value={v.chequeNumber} onChange={set('chequeNumber')} dir="ltr" className="text-start" />
          </Field>
          <Field label="البنك">
            <Input value={v.chequeBank} onChange={set('chequeBank')} />
          </Field>
          <Field label="تاريخ استحقاق الشيك" required>
            <Input type="date" value={v.chequeDue} onChange={set('chequeDue')} />
          </Field>
        </>
      ) : (
        <Field label="الصندوق/الحساب المستلم" required error={fieldErrors.cashAccountId}>
          <Select value={v.cashAccountId} onChange={set('cashAccountId')}>
            {cashAccounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="البيان" className="sm:col-span-2">
        <Input value={v.description} onChange={set('description')} placeholder={kind === 'OTHER_REVENUE' ? 'مثال: تبرع لدعم الأنشطة' : 'مثال: زيادة رأس المال'} />
      </Field>
      <Field label="ملاحظات" className="sm:col-span-2">
        <Textarea value={v.notes} onChange={set('notes')} rows={2} />
      </Field>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <p className="text-sm text-slate-500">المبلغ: {f.money(v.amount || 0)}</p>
        <Button type="submit" size="lg" loading={pending}>
          {!pending ? <Save /> : null}
          حفظ السند
        </Button>
      </div>
    </form>
  )
}
