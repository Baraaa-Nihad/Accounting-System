'use client'

import * as React from 'react'
import Link from 'next/link'
import { HandCoins, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createAdvanceAction } from '@/app/(app)/payroll/actions'
import { ARABIC_MONTHS, parts } from '@/lib/dates'
import { D, Decimal } from '@/lib/money'
import { PAYMENT_METHOD } from '@/lib/labels'

/** سلفة جديدة: تُصرف بسند صرف وتُخصم أقساطها تلقائيًا من الرواتب. */
export function AdvanceDialog({
  employees,
  fixedEmployeeId,
  cashAccounts,
}: {
  employees: { id: number; fullName: string }[]
  fixedEmployeeId?: number
  cashAccounts: { id: number; name: string; type: string; balance: string; isDefault: boolean }[]
}) {
  const { today } = useApp()
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const t = parts(today)
  const defaultCash = cashAccounts.find((c) => c.isDefault && c.type === 'CASHBOX') ?? cashAccounts[0]
  const blank = () => ({
    employeeId: fixedEmployeeId ? String(fixedEmployeeId) : '',
    date: today,
    amount: '',
    installmentsCount: '1',
    monthlyDeduction: '',
    startYear: String(t.y),
    startMonth: String(t.m),
    reason: '',
    cashAccountId: String(defaultCash?.id ?? ''),
    paymentMethod: 'CASH',
  })
  const [v, setV] = React.useState(blank)
  const [done, setDone] = React.useState<{ voucherId: number; number: string } | null>(null)
  const { run, pending, fieldErrors } = useAction(createAdvanceAction, { onSuccess: setDone })
  const count = Math.max(1, Number(v.installmentsCount) || 1)
  const auto = v.amount ? D(v.amount).dividedBy(count).toDecimalPlaces(f.cfg.decimals, Decimal.ROUND_UP) : null
  const cash = cashAccounts.find((c) => String(c.id) === v.cashAccountId)
  const over = cash && v.amount && D(v.amount).greaterThan(D(cash.balance))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setV(blank())
          setDone(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <HandCoins />
          سلفة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent
        title="صرف سلفة لموظف"
        description="تُصرف بسند صرف «سلفة»، وتُخصم أقساطها تلقائيًا من مسيرات الرواتب ابتداءً من الشهر المحدد."
        footer={
          done ? (
            <Button asChild>
              <Link href={`/print/vouchers/${done.voucherId}?auto=1`} target="_blank">
                <Printer />
                طباعة سند {done.number}
              </Link>
            </Button>
          ) : (
            <Button
              loading={pending}
              disabled={!!over}
              onClick={() =>
                run({
                  ...v,
                  monthlyDeduction: v.monthlyDeduction || null,
                })
              }
            >
              صرف السلفة
            </Button>
          )
        }
      >
        {done ? (
          <p className="py-6 text-center text-lg font-semibold text-emerald-700">تم صرف السلفة بالسند {done.number}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedEmployeeId ? (
              <Field label="الموظف" required error={fieldErrors.employeeId} className="sm:col-span-2">
                <Select value={v.employeeId} onChange={(e) => setV((p) => ({ ...p, employeeId: e.target.value }))}>
                  <option value="">اختر الموظف</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="مبلغ السلفة" required error={fieldErrors.amount}>
              <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} />
            </Field>
            <Field label="التاريخ" required error={fieldErrors.date}>
              <Input type="date" value={v.date} onChange={(e) => setV((p) => ({ ...p, date: e.target.value }))} />
            </Field>
            <Field label="عدد الأقساط" required error={fieldErrors.installmentsCount}>
              <Input value={v.installmentsCount} onChange={(e) => setV((p) => ({ ...p, installmentsCount: e.target.value.replace(/\D/g, '') }))} dir="ltr" className="text-center" inputMode="numeric" />
            </Field>
            <Field label="القسط الشهري" error={fieldErrors.monthlyDeduction} hint={auto ? `تلقائيًا: ${f.moneyText(auto)}` : undefined}>
              <MoneyInput value={v.monthlyDeduction} onChange={(x) => setV((p) => ({ ...p, monthlyDeduction: x }))} placeholder={auto?.toString() ?? ''} />
            </Field>
            <Field label="يبدأ الخصم من شهر" error={fieldErrors.startMonth}>
              <Select value={v.startMonth} onChange={(e) => setV((p) => ({ ...p, startMonth: e.target.value }))}>
                {ARABIC_MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} — {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="سنة البدء" error={fieldErrors.startYear}>
              <Input value={v.startYear} onChange={(e) => setV((p) => ({ ...p, startYear: e.target.value.replace(/\D/g, '') }))} dir="ltr" className="text-center" inputMode="numeric" />
            </Field>
            <Field label="الطريقة">
              <Select value={v.paymentMethod} onChange={(e) => setV((p) => ({ ...p, paymentMethod: e.target.value }))}>
                {Object.entries(PAYMENT_METHOD)
                  .filter(([k]) => k !== 'CHEQUE')
                  .map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="يُصرف من" required error={fieldErrors.cashAccountId ?? (over ? 'أكبر من الرصيد المتاح' : undefined)} hint={cash ? <>الرصيد: {f.money(cash.balance)}</> : undefined}>
              <Select value={v.cashAccountId} onChange={(e) => setV((p) => ({ ...p, cashAccountId: e.target.value }))}>
                {cashAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السبب" className="sm:col-span-2">
              <Input value={v.reason} onChange={(e) => setV((p) => ({ ...p, reason: e.target.value }))} />
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
