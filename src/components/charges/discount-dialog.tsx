'use client'

import * as React from 'react'
import { Percent, BadgePercent } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { addDiscountAction } from '@/app/(app)/charges/actions'
import { D, percentOf, sum } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { DiscountTypeOption } from './charge-form'

export interface DiscountChargeOption {
  id: number
  label: string
  chargeTypeId: number
  chargeTypeName: string
  academicYearId: number
  gross: string
  net: string
  paid: string
}

export function DiscountDialog({
  studentId,
  charges,
  discountTypes,
  years,
  defaultYearId,
  presetChargeId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  studentId: number
  charges: DiscountChargeOption[]
  discountTypes: DiscountTypeOption[]
  years: { id: number; name: string; status: string }[]
  defaultYearId: number | null
  presetChargeId?: number
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { today, format } = useApp()
  const f = useFormat()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : internalOpen
  const setOpen = (o: boolean) => (controlled ? onOpenChange?.(o) : setInternalOpen(o))
  const preset = charges.find((c) => c.id === presetChargeId)
  const [scope, setScope] = React.useState<'CHARGE' | 'CHARGE_TYPE' | 'ACCOUNT'>(presetChargeId ? 'CHARGE' : 'CHARGE')
  const [chargeId, setChargeId] = React.useState(presetChargeId ? String(presetChargeId) : '')
  const [chargeTypeId, setChargeTypeId] = React.useState('')
  const [yearId, setYearId] = React.useState(String(preset?.academicYearId ?? defaultYearId ?? ''))
  const [method, setMethod] = React.useState<'PERCENT' | 'FIXED'>('PERCENT')
  const [value, setValue] = React.useState('')
  const [discountTypeId, setDiscountTypeId] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [approvedBy, setApprovedBy] = React.useState('')
  const [date, setDate] = React.useState(today)
  const [distribution, setDistribution] = React.useState<'EVEN' | 'FROM_LAST'>('EVEN')
  const [makeRule, setMakeRule] = React.useState(false)

  const { run, pending, fieldErrors } = useAction(addDiscountAction, { onSuccess: () => setOpen(false) })

  const yearCharges = charges.filter((c) => String(c.academicYearId) === yearId)
  const targets =
    scope === 'CHARGE'
      ? charges.filter((c) => String(c.id) === chargeId)
      : scope === 'CHARGE_TYPE'
        ? yearCharges.filter((c) => String(c.chargeTypeId) === chargeTypeId)
        : yearCharges
  const open_ = targets.filter((c) => D(c.net).minus(D(c.paid)).greaterThan(0))
  const base = sum(open_.map((c) => c.gross))
  const available = sum(open_.map((c) => D(c.net).minus(D(c.paid))))
  const estimated =
    method === 'PERCENT' ? sum(open_.map((c) => percentOf(c.gross, value || '0', format.decimals))) : D(value || '0')
  const typesInYear = Array.from(new Map(yearCharges.map((c) => [c.chargeTypeId, c.chargeTypeName])).entries())

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="secondary">
              <BadgePercent />
              إضافة خصم
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent
        title="إضافة خصم"
        description="الخصم يُطبق على الجزء غير المدفوع، ويُعاد توزيع الأقساط تلقائيًا."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                run({
                  studentId,
                  scope,
                  chargeId: scope === 'CHARGE' ? chargeId : null,
                  chargeTypeId: scope === 'CHARGE_TYPE' ? chargeTypeId : null,
                  academicYearId: scope === 'CHARGE' ? (charges.find((c) => String(c.id) === chargeId)?.academicYearId ?? yearId) : yearId,
                  method,
                  value,
                  discountTypeId,
                  reason,
                  approvedBy,
                  date,
                  distribution,
                  makeRule,
                })
              }
            >
              تطبيق الخصم
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="الخصم على">
            <div className="grid grid-cols-3 gap-2">
              {([
                ['CHARGE', 'ذمة معينة'],
                ['CHARGE_TYPE', 'نوع رسوم معين'],
                ['ACCOUNT', 'كامل حساب الطالب'],
              ] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScope(k)}
                  className={cn('h-11 rounded-xl border text-sm font-medium', scope === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {scope === 'CHARGE' ? (
              <Field label="الذمة" required error={fieldErrors.chargeId} className="sm:col-span-2">
                <Select value={chargeId} onChange={(e) => setChargeId(e.target.value)}>
                  <option value="">اختر الذمة</option>
                  {charges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} — المتبقي {D(c.net).minus(D(c.paid)).toFixed(format.decimals)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <>
                <Field label="السنة الدراسية">
                  <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
                    {years.map((y) => (
                      <option key={y.id} value={y.id} disabled={y.status === 'CLOSED'}>
                        {y.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {scope === 'CHARGE_TYPE' ? (
                  <Field label="نوع الرسوم" required error={fieldErrors.chargeTypeId}>
                    <Select value={chargeTypeId} onChange={(e) => setChargeTypeId(e.target.value)}>
                      <option value="">اختر النوع</option>
                      {typesInYear.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </>
            )}
            <Field label="نوع الخصم">
              <Select
                value={discountTypeId}
                onChange={(e) => {
                  setDiscountTypeId(e.target.value)
                  const dt = discountTypes.find((x) => String(x.id) === e.target.value)
                  if (dt?.defaultMethod) setMethod(dt.defaultMethod)
                  if (dt?.defaultValue) setValue(dt.defaultValue)
                  if (dt && !reason) setReason(dt.name)
                }}
              >
                <option value="">—</option>
                {discountTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="طريقة الخصم">
              <div className="grid grid-cols-2 gap-2">
                {(['PERCENT', 'FIXED'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn('h-10 rounded-xl border text-sm font-medium', method === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600')}
                  >
                    {m === 'PERCENT' ? 'نسبة %' : 'مبلغ ثابت'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={method === 'PERCENT' ? 'نسبة الخصم %' : 'قيمة الخصم'} required error={fieldErrors.value}>
              {method === 'PERCENT' ? (
                <div className="relative">
                  <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" className="num pr-9 text-left" />
                  <Percent className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                </div>
              ) : (
                <MoneyInput value={value} onChange={setValue} />
              )}
            </Field>
            <Field label="تاريخ الخصم" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="سبب الخصم" required error={fieldErrors.reason}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label="من وافق على الخصم">
              <Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
            </Field>
            <Field label="توزيع الخصم على الأقساط" className="sm:col-span-2">
              <Select value={distribution} onChange={(e) => setDistribution(e.target.value as 'EVEN' | 'FROM_LAST')}>
                <option value="EVEN">بالتساوي على الأقساط غير المدفوعة</option>
                <option value="FROM_LAST">من آخر الأقساط</option>
              </Select>
            </Field>
            {scope !== 'CHARGE' ? (
              <div className="sm:col-span-2">
                <Checkbox checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} label="خصم دائم" description="يُطبق تلقائيًا على الذمم المستقبلية من نفس النوع (مثل خصم الإخوة)" />
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
            <div>
              <p className="text-slate-500">المبلغ قبل الخصم</p>
              <p className="font-semibold">{f.money(base)}</p>
            </div>
            <div>
              <p className="text-slate-500">قيمة الخصم التقريبية</p>
              <p className="font-semibold text-emerald-700">{f.money(estimated)}</p>
            </div>
            <div>
              <p className="text-slate-500">المتاح للخصم (غير مدفوع)</p>
              <p className="font-semibold">{f.money(available)}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
