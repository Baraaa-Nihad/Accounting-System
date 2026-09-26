'use client'

import * as React from 'react'
import Link from 'next/link'
import { Wand2, CheckCircle2, Printer, Plus, Banknote, Landmark, CreditCard, Smartphone, FileCheck2, CircleEllipsis, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createStudentReceiptAction, loadPaymentContextAction, type PaymentContext } from '@/app/(app)/receipts/actions'
import { D, sum, ZERO } from '@/lib/money'
import { installmentDisplayStatus } from '@/lib/schedule'
import { INSTALLMENT_DISPLAY } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type Decimal from 'decimal.js'

const METHODS = [
  { key: 'CASH', label: 'نقدي', icon: Banknote },
  { key: 'CHEQUE', label: 'شيك', icon: FileCheck2 },
  { key: 'BANK_TRANSFER', label: 'حوالة بنكية', icon: Landmark },
  { key: 'CARD', label: 'بطاقة', icon: CreditCard },
  { key: 'ELECTRONIC', label: 'إلكتروني', icon: Smartphone },
  { key: 'OTHER', label: 'أخرى', icon: CircleEllipsis },
] as const

type Method = (typeof METHODS)[number]['key']

function autoFill(amount: Decimal, rows: { id: number; remaining: string }[]): Record<number, string> {
  let left = amount
  const out: Record<number, string> = {}
  for (const r of rows) {
    const rem = D(r.remaining)
    const take = left.lessThan(rem) ? left : rem
    out[r.id] = take.greaterThan(0) ? take.toString() : ''
    left = left.minus(take.greaterThan(0) ? take : ZERO)
  }
  return out
}

export function PaymentForm({
  studentId,
  guardianId,
  onClose,
}: {
  studentId?: number
  guardianId?: number
  onClose: () => void
}) {
  const { today } = useApp()
  const f = useFormat()
  const [ctx, setCtx] = React.useState<PaymentContext | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState('')
  const [alloc, setAlloc] = React.useState<Record<number, string>>({})
  const [touched, setTouched] = React.useState(false)
  const [method, setMethod] = React.useState<Method>('CASH')
  const [cashAccountId, setCashAccountId] = React.useState('')
  const [date, setDate] = React.useState(today)
  const [payerName, setPayerName] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [cheque, setCheque] = React.useState({ number: '', bankName: '', dueDate: today, drawerName: '', deposit: false, depositToAccountId: '' })
  const [creditStudentId, setCreditStudentId] = React.useState('')
  const [creditPrompt, setCreditPrompt] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<{ id: number; number: string } | null>(null)

  const { run, pending, fieldErrors } = useAction(createStudentReceiptAction, { onSuccess: (d) => setDone(d) })

  React.useEffect(() => {
    let cancelled = false
    loadPaymentContextAction({ studentId, guardianId }).then((r) => {
      if (cancelled) return
      if (!r.ok) return setLoadError(r.error)
      setCtx(r.data)
      setPayerName(r.data.payerName)
      const def = r.data.cashAccounts.find((c) => c.isDefault && c.type === 'CASHBOX') ?? r.data.cashAccounts[0]
      if (def) setCashAccountId(String(def.id))
      setCreditStudentId(String(r.data.students[0]?.id ?? ''))
    })
    return () => {
      cancelled = true
    }
  }, [studentId, guardianId])

  const rows = ctx?.installments ?? []
  const totalDue = sum(rows.map((r) => r.remaining))
  const amt = D(amount || '0')
  const allocated = sum(Object.values(alloc).map((v) => v || '0'))
  const leftover = amt.minus(allocated)
  const multi = (ctx?.students.length ?? 0) > 1

  function setAmountAndAuto(v: string) {
    setAmount(v)
    if (!touched) setAlloc(autoFill(D(v || '0'), rows))
  }

  function onMethod(m: Method) {
    setMethod(m)
    if (!ctx) return
    const preferred = m === 'CASH' ? ctx.cashAccounts.find((c) => c.type === 'CASHBOX') : ctx.cashAccounts.find((c) => c.type === 'BANK')
    if (preferred) setCashAccountId(String(preferred.id))
  }

  function submit(confirmCredit = false) {
    setCreditPrompt(null)
    run({
      kind: guardianId ? 'FAMILY' : 'STUDENT',
      studentId: studentId ?? null,
      guardianId: guardianId ?? null,
      date,
      amount,
      paymentMethod: method,
      cashAccountId: method === 'CHEQUE' ? null : cashAccountId,
      cheque:
        method === 'CHEQUE'
          ? {
              number: cheque.number,
              bankName: cheque.bankName,
              dueDate: cheque.dueDate,
              drawerName: cheque.drawerName,
              depositToAccountId: cheque.deposit ? cheque.depositToAccountId : null,
            }
          : null,
      payerName,
      referenceNumber: reference,
      notes,
      allocations: Object.entries(alloc)
        .filter(([, v]) => v && D(v).greaterThan(0))
        .map(([id, v]) => ({ installmentId: Number(id), amount: v })),
      creditStudentId: creditStudentId || null,
      confirmCredit,
    }).then((r) => {
      if (!r.ok && r.fieldErrors?._credit) setCreditPrompt(r.fieldErrors._credit)
    })
  }

  if (loadError) return <p className="text-rose-600">{loadError}</p>
  if (!ctx)
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="size-5 animate-spin" /> جارٍ تحميل المستحقات…
      </div>
    )

  if (done) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-9" />
        </div>
        <p className="text-lg font-bold text-slate-900">تم حفظ سند القبض</p>
        <p className="num mt-1 text-2xl font-bold text-brand-700">{done.number}</p>
        <p className="mt-1 text-slate-500">بمبلغ {f.money(amount)}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button size="lg" asChild>
            <Link href={`/print/receipts/${done.id}?auto=1`} target="_blank">
              <Printer />
              طباعة السند
            </Link>
          </Button>
          <Button size="lg" variant="secondary" asChild>
            <Link href={`/receipts/${done.id}`}>عرض السند</Link>
          </Button>
          <Button size="lg" variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    )
  }

  const creditTotal = sum(ctx.students.map((s) => s.credit))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="المبلغ المدفوع" required error={fieldErrors.amount}>
          <MoneyInput value={amount} onChange={setAmountAndAuto} large autoFocus />
        </Field>
        <div className="flex gap-4 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm">
          <div>
            <p className="text-slate-500">إجمالي المستحقات المفتوحة</p>
            <p className="font-bold">{f.money(totalDue)}</p>
          </div>
          {creditTotal.greaterThan(0) ? (
            <div>
              <p className="text-slate-500">رصيد دائن سابق</p>
              <p className="font-bold text-emerald-700">{f.money(creditTotal)}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">توزيع الدفعة على المستحقات</p>
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={() => {
              setTouched(false)
              setAlloc(autoFill(amt, rows))
            }}
          >
            <Wand2 />
            توزيع تلقائي (الأقدم أولًا)
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            لا توجد مستحقات مفتوحة. سيُسجل المبلغ رصيدًا دائنًا ويُطبق تلقائيًا عند الحاجة.
          </p>
        ) : (
          <div className="scroll-thin max-h-72 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  {multi ? <th className="px-3 py-2 text-start font-semibold">الطالب</th> : null}
                  <th className="px-3 py-2 text-start font-semibold">الذمة</th>
                  <th className="px-3 py-2 text-start font-semibold">الاستحقاق</th>
                  <th className="px-3 py-2 text-end font-semibold">المتبقي</th>
                  <th className="px-3 py-2 text-end font-semibold">يُدفع الآن</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = installmentDisplayStatus({ status: D(r.paid).greaterThan(0) ? 'PARTIAL' : 'UNPAID', dueDate: r.dueDate, amount: r.amount, paidAmount: r.paid }, today, 0)
                  const v = alloc[r.id] ?? ''
                  const over = v && D(v).greaterThan(D(r.remaining))
                  return (
                    <tr key={r.id} className={cn('border-t border-slate-100', v && D(v).greaterThan(0) && 'bg-brand-50/40')}>
                      {multi ? <td className="px-3 py-1.5 text-slate-700">{r.studentName}</td> : null}
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{r.chargeTypeName}</span>
                        {r.installmentCount > 1 ? <span className="text-xs text-slate-500"> — القسط {r.number}</span> : null}
                        <span className="ms-1 text-xs text-slate-400">({r.yearName})</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {f.date(r.dueDate)}
                          {st === 'OVERDUE' || st === 'PARTIAL_OVERDUE' || st === 'DUE' ? <StatusBadge map={INSTALLMENT_DISPLAY} value={st} /> : null}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-end">{f.money(r.remaining)}</td>
                      <td className="w-36 px-3 py-1.5">
                        <Input
                          value={v}
                          onChange={(e) => {
                            setTouched(true)
                            setAlloc((a) => ({ ...a, [r.id]: e.target.value.replace(/[^\d.]/g, '') }))
                          }}
                          dir="ltr"
                          inputMode="decimal"
                          className={cn('num h-8 text-left', over && 'border-rose-400')}
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            الموزع: <b>{f.money(allocated)}</b>
          </span>
          {leftover.greaterThan(0) ? (
            <span className="text-emerald-700">
              يُسجل رصيدًا دائنًا: <b>{f.money(leftover)}</b>
            </span>
          ) : null}
          {leftover.isNegative() ? <span className="font-medium text-rose-600">التوزيع أكبر من المبلغ المدفوع بـ {f.money(leftover.abs())}</span> : null}
        </div>
        {multi && leftover.greaterThan(0) ? (
          <Field label="الرصيد الدائن يُسجل على حساب" className="mt-3 max-w-xs">
            <Select value={creditStudentId} onChange={(e) => setCreditStudentId(e.target.value)}>
              {ctx.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <Field label="طريقة الدفع">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onMethod(m.key)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors',
                method === m.key ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              <m.icon className="size-5" />
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      {method === 'CHEQUE' ? (
        <div className="grid gap-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:grid-cols-2">
          <Field label="رقم الشيك" required error={fieldErrors['cheque.number']}>
            <Input value={cheque.number} onChange={(e) => setCheque((c) => ({ ...c, number: e.target.value }))} dir="ltr" className="text-start" />
          </Field>
          <Field label="البنك المسحوب عليه">
            <Input value={cheque.bankName} onChange={(e) => setCheque((c) => ({ ...c, bankName: e.target.value }))} />
          </Field>
          <Field label="تاريخ استحقاق الشيك" required error={fieldErrors['cheque.dueDate']}>
            <Input type="date" value={cheque.dueDate} onChange={(e) => setCheque((c) => ({ ...c, dueDate: e.target.value }))} />
          </Field>
          <Field label="اسم الساحب">
            <Input value={cheque.drawerName} onChange={(e) => setCheque((c) => ({ ...c, drawerName: e.target.value }))} placeholder={payerName} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              checked={cheque.deposit}
              onChange={(e) => setCheque((c) => ({ ...c, deposit: e.target.checked }))}
              label="أُودع الشيك في البنك مباشرة"
              description="إذا لم تحدد ذلك يدخل الشيك «حافظة الشيكات» حتى تحصيله"
            />
            {cheque.deposit ? (
              <Select className="mt-2 max-w-xs" value={cheque.depositToAccountId} onChange={(e) => setCheque((c) => ({ ...c, depositToAccountId: e.target.value }))}>
                <option value="">اختر الحساب البنكي</option>
                {ctx.cashAccounts
                  .filter((c) => c.type === 'BANK')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={method === 'CASH' ? 'الصندوق المستلم' : 'الحساب المستلم'} required error={fieldErrors.cashAccountId}>
            <Select value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
              {ctx.cashAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.type === 'BANK' ? '(بنك)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {method !== 'CASH' ? (
            <Field label="رقم المرجع / الحوالة">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" className="text-start" />
            </Field>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="تاريخ الدفعة" required error={fieldErrors.date}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="اسم الدافع">
          <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} />
        </Field>
        <Field label="ملاحظات" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>

      {creditPrompt ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>
            المبلغ المدفوع أكبر من المستحقات الموزعة بـ <b>{f.money(creditPrompt)}</b>. سيُسجل هذا الفرق <b>رصيدًا دائنًا</b> للطالب، ويمكن تطبيقه لاحقًا على ذمم جديدة أو رده.
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="success" loading={pending} onClick={() => submit(true)}>
              موافق، احفظ السند
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreditPrompt(null)}>
              تعديل المبلغ
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-sm text-slate-500">
          سيُنشأ <Badge tone="teal">سند قبض</Badge> برقم تلقائي ويُحدّث الصندوق وكشف الحساب فورًا.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" size="lg" loading={pending} disabled={!amt.greaterThan(0) || leftover.isNegative()}>
            {!pending ? <Plus /> : null}
            حفظ الدفعة وإنشاء السند
          </Button>
        </div>
      </div>
    </form>
  )
}
