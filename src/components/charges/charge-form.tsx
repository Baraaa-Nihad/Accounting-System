'use client'

import * as React from 'react'
import { Save, CalendarClock, Percent, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { StudentPicker, type PickedStudent } from '@/components/forms/student-picker'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createChargeAction } from '@/app/(app)/charges/actions'
import { buildSchedule, previewDiscount } from '@/lib/schedule'
import { D, sum } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/ui/tooltip'

export interface ChargeTypeOption {
  id: number
  name: string
  defaultAmount: string | null
  allowInstallments: boolean
}

export interface DiscountTypeOption {
  id: number
  name: string
  defaultMethod: 'PERCENT' | 'FIXED' | null
  defaultValue: string | null
}

export function ChargeForm({
  fixedStudent,
  chargeTypes,
  discountTypes,
  years,
  defaultYearId,
  canDiscount,
  onDone,
  onCancel,
}: {
  fixedStudent?: PickedStudent | null
  chargeTypes: ChargeTypeOption[]
  discountTypes: DiscountTypeOption[]
  years: { id: number; name: string; status: string }[]
  defaultYearId: number | null
  canDiscount: boolean
  onDone?: (id: number) => void
  onCancel?: () => void
}) {
  const { today, format } = useApp()
  const f = useFormat()
  const [student, setStudent] = React.useState<PickedStudent | null>(fixedStudent ?? null)
  const [chargeTypeId, setChargeTypeId] = React.useState('')
  const [yearId, setYearId] = React.useState(String(defaultYearId ?? years.find((y) => y.status === 'OPEN')?.id ?? ''))
  const [date, setDate] = React.useState(today)
  const [dueDate, setDueDate] = React.useState(today)
  const [gross, setGross] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [discountOn, setDiscountOn] = React.useState(false)
  const [discount, setDiscount] = React.useState({ method: 'PERCENT' as 'PERCENT' | 'FIXED', value: '', discountTypeId: '', reason: '', approvedBy: '' })
  const [installOn, setInstallOn] = React.useState(false)
  const [count, setCount] = React.useState('8')
  const [firstDueDate, setFirstDueDate] = React.useState(today)
  const [dueDay, setDueDay] = React.useState('')
  const [custom, setCustom] = React.useState<{ dueDate: string; amount: string }[] | null>(null)
  const [applyRules, setApplyRules] = React.useState(true)

  const { run, pending, fieldErrors } = useAction(createChargeAction, { onSuccess: (d) => onDone?.(d.id) })

  const type = chargeTypes.find((t) => String(t.id) === chargeTypeId)
  const preview = discountOn && discount.value ? previewDiscount(gross, discount.method, discount.value, format.decimals) : previewDiscount(gross, 'FIXED', '0', format.decimals)
  const net = preview.net
  const countNum = Math.min(Math.max(Number(count) || 1, 1), 60)
  let generated: { dueDate: string; amount: ReturnType<typeof previewDiscount>['net'] }[] = []
  if (installOn && net.greaterThan(0) && firstDueDate) {
    try {
      generated = buildSchedule(net, countNum, firstDueDate, format.decimals, dueDay ? Number(dueDay) : null)
    } catch {
      generated = []
    }
  }
  const schedule = custom ?? generated.map((l) => ({ dueDate: l.dueDate, amount: l.amount.toFixed(format.decimals) }))
  const scheduleSum = sum(schedule.map((l) => l.amount || '0'))
  const scheduleDiff = net.minus(scheduleSum)

  function onTypeChange(id: string) {
    setChargeTypeId(id)
    const t = chargeTypes.find((x) => String(x.id) === id)
    if (t?.defaultAmount && !gross) setGross(t.defaultAmount)
    if (t) setInstallOn(t.allowInstallments)
    setCustom(null)
  }

  function submit() {
    run({
      studentId: student?.id,
      chargeTypeId,
      academicYearId: yearId,
      date,
      dueDate: installOn ? null : dueDate,
      grossAmount: gross,
      description,
      notes,
      discount: discountOn
        ? { method: discount.method, value: discount.value, discountTypeId: discount.discountTypeId, reason: discount.reason, approvedBy: discount.approvedBy }
        : null,
      installments: installOn
        ? { count: custom ? custom.length : countNum, firstDueDate, dueDay, schedule: custom }
        : null,
      applyRules,
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="grid gap-6 lg:grid-cols-5"
    >
      <div className="space-y-4 lg:col-span-3">
        {!fixedStudent ? (
          <Field label="الطالب" required error={fieldErrors.studentId}>
            <StudentPicker value={student} onChange={setStudent} invalid={!!fieldErrors.studentId} autoFocus />
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع الذمة" required error={fieldErrors.chargeTypeId}>
            <Select value={chargeTypeId} onChange={(e) => onTypeChange(e.target.value)} aria-invalid={!!fieldErrors.chargeTypeId}>
              <option value="">اختر النوع</option>
              {chargeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="قيمة الذمة (قبل الخصم)" required error={fieldErrors.grossAmount}>
            <MoneyInput value={gross} onChange={(v) => { setGross(v); setCustom(null) }} aria-invalid={!!fieldErrors.grossAmount} />
          </Field>
          <Field label="السنة الدراسية" required error={fieldErrors.academicYearId}>
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
              {years.map((y) => (
                <option key={y.id} value={y.id} disabled={y.status === 'CLOSED'}>
                  {y.name}
                  {y.status === 'CLOSED' ? ' (مغلقة)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تاريخ الذمة" required error={fieldErrors.date}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="البيان" hint="وصف مختصر يظهر في كشف الحساب (اختياري)" className="sm:col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={type ? `مثال: ${type.name} للفصل الأول` : ''} />
          </Field>
        </div>

        {canDiscount ? (
          <div className={cn('rounded-2xl border p-4', discountOn ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200')}>
            <Checkbox checked={discountOn} onChange={(e) => { setDiscountOn(e.target.checked); setCustom(null) }} label="يوجد خصم على هذه الذمة" description="خصم بنسبة مئوية أو بمبلغ ثابت، مع السبب ومن وافق عليه" />
            {discountOn ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="نوع الخصم">
                  <Select
                    value={discount.discountTypeId}
                    onChange={(e) => {
                      const dt = discountTypes.find((x) => String(x.id) === e.target.value)
                      setDiscount((d) => ({
                        ...d,
                        discountTypeId: e.target.value,
                        method: dt?.defaultMethod ?? d.method,
                        value: dt?.defaultValue ?? d.value,
                        reason: d.reason || dt?.name || '',
                      }))
                      setCustom(null)
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
                        onClick={() => { setDiscount((d) => ({ ...d, method: m })); setCustom(null) }}
                        className={cn('h-10 rounded-xl border text-sm font-medium', discount.method === m ? 'border-brand-500 bg-white text-brand-700 ring-2 ring-brand-500/20' : 'border-slate-300 bg-white text-slate-600')}
                      >
                        {m === 'PERCENT' ? 'نسبة %' : 'مبلغ ثابت'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={discount.method === 'PERCENT' ? 'نسبة الخصم %' : 'قيمة الخصم'} required error={fieldErrors['discount.value']}>
                  {discount.method === 'PERCENT' ? (
                    <div className="relative">
                      <Input value={discount.value} onChange={(e) => { setDiscount((d) => ({ ...d, value: e.target.value })); setCustom(null) }} inputMode="decimal" dir="ltr" className="num pr-9 text-left" />
                      <Percent className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  ) : (
                    <MoneyInput value={discount.value} onChange={(v) => { setDiscount((d) => ({ ...d, value: v })); setCustom(null) }} />
                  )}
                </Field>
                <Field label="من وافق على الخصم">
                  <Input value={discount.approvedBy} onChange={(e) => setDiscount((d) => ({ ...d, approvedBy: e.target.value }))} placeholder="اسم الشخص" />
                </Field>
                <Field label="سبب الخصم" required error={fieldErrors['discount.reason']} className="sm:col-span-2">
                  <Input value={discount.reason} onChange={(e) => setDiscount((d) => ({ ...d, reason: e.target.value }))} />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={cn('rounded-2xl border p-4', installOn ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200')}>
          <Checkbox checked={installOn} onChange={(e) => { setInstallOn(e.target.checked); setCustom(null) }} label="تقسيط المبلغ" description="يقسم النظام المبلغ النهائي بعد الخصم على أقساط شهرية تلقائيًا" />
          {installOn ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="عدد الأقساط" required>
                <Input value={count} onChange={(e) => { setCount(e.target.value.replace(/\D/g, '')); setCustom(null) }} inputMode="numeric" dir="ltr" className="num text-left" />
              </Field>
              <Field label="تاريخ أول قسط" required error={fieldErrors['installments.firstDueDate']}>
                <Input type="date" value={firstDueDate} onChange={(e) => { setFirstDueDate(e.target.value); setCustom(null) }} />
              </Field>
              <Field label={<span className="inline-flex items-center gap-1">يوم الاستحقاق <Hint content="يوم ثابت في كل شهر (مثل 5). إذا كان الشهر أقصر يُستخدم آخر يوم فيه." /></span>}>
                <Input value={dueDay} onChange={(e) => { setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2)); setCustom(null) }} inputMode="numeric" placeholder="تلقائي" dir="ltr" className="num text-left" />
              </Field>
            </div>
          ) : (
            <Field label="تاريخ الاستحقاق" className="mt-4 max-w-xs">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
        </div>

        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <Checkbox checked={applyRules} onChange={(e) => setApplyRules(e.target.checked)} label="تطبيق الخصومات الدائمة للطالب (إن وجدت)" description="مثل خصم الإخوة المسجل على الطالب" />
      </div>

      <div className="lg:col-span-2">
        <div className="sticky top-4 space-y-4 rounded-2xl bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900">المعاينة</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">المبلغ قبل الخصم</dt>
              <dd>{f.money(preview.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">قيمة الخصم</dt>
              <dd className="text-emerald-700">{f.money(preview.amount)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
              <dt>المبلغ النهائي</dt>
              <dd>{f.money(net)}</dd>
            </div>
          </dl>
          {installOn && schedule.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <CalendarClock className="size-4" />
                  جدول الأقساط ({schedule.length})
                </p>
                {custom ? (
                  <button type="button" onClick={() => setCustom(null)} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
                    <RotateCcw className="size-3" /> إعادة التوليد
                  </button>
                ) : (
                  <button type="button" onClick={() => setCustom(schedule)} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
                    <Pencil className="size-3" /> تعديل يدوي
                  </button>
                )}
              </div>
              <div className="scroll-thin max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {schedule.map((l, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-slate-500">القسط {i + 1}</td>
                        <td className="px-2 py-1.5">
                          {custom ? (
                            <Input type="date" value={l.dueDate} className="h-8 text-xs" onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                          ) : (
                            f.date(l.dueDate)
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-end">
                          {custom ? (
                            <Input value={l.amount} className="num h-8 w-28 text-left text-xs" dir="ltr" onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                          ) : (
                            f.money(l.amount)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {custom && !scheduleDiff.isZero() ? (
                <p className="mt-2 text-xs font-medium text-rose-600">
                  مجموع الأقساط لا يساوي المبلغ النهائي (الفرق {f.money(scheduleDiff)})
                </p>
              ) : null}
              {custom ? (
                <div className="mt-2 flex gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setCustom([...custom, { dueDate: custom[custom.length - 1]?.dueDate ?? today, amount: '0' }])}>
                    + قسط
                  </Button>
                  {custom.length > 1 ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setCustom(custom.slice(0, -1))}>
                      حذف آخر قسط
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {D(gross || '0').greaterThan(0) && net.isNegative() ? <p className="text-xs text-rose-600">الخصم أكبر من قيمة الذمة</p> : null}
          <div className="flex flex-col gap-2 pt-2">
            <Button type="submit" size="lg" loading={pending} disabled={!!custom && !scheduleDiff.isZero()}>
              {!pending ? <Save /> : null}
              حفظ الذمة
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                إلغاء
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  )
}
