'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Eye,
  HandCoins,
  Hammer,
  Printer,
  Receipt,
  Save,
  Truck,
  Undo2,
  UserRoundMinus,
  Wallet,
  BookOpen,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { StudentPicker, type PickedStudent } from '@/components/forms/student-picker'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createVoucherAction, loadRefundContextAction } from '@/app/(app)/vouchers/actions'
import { PAYMENT_METHOD } from '@/lib/labels'
import { D } from '@/lib/money'
import { cn } from '@/lib/utils'

export type VoucherFormKind = 'EXPENSE' | 'SUPPLIER_PAYMENT' | 'CONTRACTOR_PAYMENT' | 'SALARY' | 'STUDENT_REFUND' | 'PARTNER_WITHDRAWAL' | 'OTHER'

const KIND_META: Record<VoucherFormKind, { label: string; hint: string; icon: React.ReactNode }> = {
  EXPENSE: { label: 'مصروف', hint: 'كهرباء، إيجار، صيانة، قرطاسية...', icon: <Receipt /> },
  SUPPLIER_PAYMENT: { label: 'دفعة لمورد', hint: 'سداد فواتير مورد', icon: <Truck /> },
  CONTRACTOR_PAYMENT: { label: 'دفعة لعامل/مقاول', hint: 'عن عمل أو اتفاق مسجل', icon: <Hammer /> },
  SALARY: { label: 'راتب', hint: 'من مسير رواتب معتمد', icon: <Wallet /> },
  STUDENT_REFUND: { label: 'مرتجع لطالب', hint: 'إرجاع رصيد دائن لولي الأمر', icon: <Undo2 /> },
  PARTNER_WITHDRAWAL: { label: 'سحب شريك', hint: 'مسحوبات شخصية لشريك', icon: <UserRoundMinus /> },
  OTHER: { label: 'صرف على حساب', hint: 'قيد على حساب محاسبي مباشر', icon: <BookOpen /> },
}

export interface VoucherFormData {
  kinds: VoucherFormKind[]
  cashAccounts: { id: number; name: string; type: 'CASHBOX' | 'BANK'; balance: string; isDefault: boolean }[]
  expenseAccounts: { id: number; code: string; name: string }[]
  suppliers: { id: number; name: string; balance: string }[]
  jobs: { id: number; contractorId: number; contractorName: string; description: string; agreed: string; paid: string; remaining: string }[]
  partners: { id: number; name: string }[]
  payrollItems: { id: number; label: string; remaining: string; runLabel: string }[]
  otherAccounts: { id: number; code: string; name: string }[]
}

export function VoucherForm({
  data,
  initialKind,
  initialSupplierId,
  initialJobId,
  initialPayrollItemId,
  initialPartnerId,
  initialStudent,
}: {
  data: VoucherFormData
  initialKind: VoucherFormKind
  initialSupplierId?: number | null
  initialJobId?: number | null
  initialPayrollItemId?: number | null
  initialPartnerId?: number | null
  initialStudent?: PickedStudent | null
}) {
  const { today } = useApp()
  const f = useFormat()
  const defaultCash = data.cashAccounts.find((c) => c.isDefault && c.type === 'CASHBOX') ?? data.cashAccounts.find((c) => c.isDefault) ?? data.cashAccounts[0]
  const blank = () => ({
    amount: '',
    date: today,
    paymentMethod: 'CASH',
    cashAccountId: String(defaultCash?.id ?? ''),
    payeeName: '',
    expenseAccountId: '',
    supplierId: initialSupplierId ? String(initialSupplierId) : '',
    expenseSupplierId: '',
    contractorJobId: initialJobId ? String(initialJobId) : '',
    payrollItemId: initialPayrollItemId ? String(initialPayrollItemId) : '',
    partnerId: initialPartnerId ? String(initialPartnerId) : '',
    otherAccountId: '',
    referenceNumber: '',
    description: '',
    notes: '',
    chequeNumber: '',
    chequeBank: '',
    chequeDue: today,
    allowSupplierAdvance: false,
  })
  const [kind, setKind] = React.useState<VoucherFormKind>(initialKind)
  const [v, setV] = React.useState(blank)
  const [student, setStudent] = React.useState<PickedStudent | null>(initialStudent ?? null)
  const [refund, setRefund] = React.useState<{ credit: string; payeeName: string } | null>(null)
  const [done, setDone] = React.useState<{ id: number; number: string } | null>(null)
  const { run, pending, fieldErrors } = useAction(createVoucherAction, { onSuccess: setDone })
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }))

  // الرصيد الدائن للطالب عند المرتجع
  React.useEffect(() => {
    if (kind !== 'STUDENT_REFUND' || !student) return
    let cancelled = false
    loadRefundContextAction(student.id).then((r) => {
      if (cancelled || !r.ok) return
      setRefund(r.data)
      setV((p) => ({ ...p, payeeName: p.payeeName || r.data.payeeName, amount: p.amount || (D(r.data.credit).greaterThan(0) ? r.data.credit : '') }))
    })
    return () => {
      cancelled = true
    }
  }, [kind, student])

  const cash = data.cashAccounts.find((c) => String(c.id) === v.cashAccountId)
  const supplier = data.suppliers.find((s) => String(s.id) === v.supplierId)
  const job = data.jobs.find((j) => String(j.id) === v.contractorJobId)
  const payroll = data.payrollItems.find((p) => String(p.id) === v.payrollItemId)
  const amount = D(v.amount || '0')
  const overCash = cash && amount.greaterThan(D(cash.balance))
  const supplierOver = kind === 'SUPPLIER_PAYMENT' && supplier && amount.greaterThan(D(supplier.balance))
  const cashChoices = v.paymentMethod === 'CHEQUE' ? data.cashAccounts.filter((c) => c.type === 'BANK') : data.cashAccounts

  const switchKind = (k: VoucherFormKind) => {
    setKind(k)
    setV((p) => ({ ...blank(), date: p.date, cashAccountId: p.cashAccountId, paymentMethod: p.paymentMethod }))
    setRefund(null)
    if (k !== 'STUDENT_REFUND') setStudent(null)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run({
      kind,
      date: v.date,
      amount: v.amount,
      paymentMethod: v.paymentMethod,
      cashAccountId: v.cashAccountId,
      payeeName: v.payeeName,
      expenseAccountId: kind === 'EXPENSE' ? v.expenseAccountId : null,
      supplierId: kind === 'SUPPLIER_PAYMENT' ? v.supplierId : kind === 'EXPENSE' ? v.expenseSupplierId : null,
      contractorJobId: kind === 'CONTRACTOR_PAYMENT' ? v.contractorJobId : null,
      payrollItemId: kind === 'SALARY' ? v.payrollItemId : null,
      studentId: kind === 'STUDENT_REFUND' ? (student?.id ?? null) : null,
      partnerId: kind === 'PARTNER_WITHDRAWAL' ? v.partnerId : null,
      otherAccountId: kind === 'OTHER' ? v.otherAccountId : null,
      cheque: v.paymentMethod === 'CHEQUE' ? { number: v.chequeNumber, bankName: v.chequeBank, dueDate: v.chequeDue } : null,
      referenceNumber: v.referenceNumber,
      description: v.description,
      notes: v.notes,
      allowSupplierAdvance: v.allowSupplierAdvance,
    })
  }

  if (done) {
    return (
      <div className="card flex flex-col items-center px-6 py-12 text-center">
        <CheckCircle2 className="mb-3 size-12 text-emerald-600" />
        <p className="text-lg font-bold">تم حفظ سند الصرف</p>
        <p className="num text-2xl font-bold text-brand-700">{done.number}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href={`/print/vouchers/${done.id}?auto=1`} target="_blank">
              <Printer />
              طباعة السند
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/vouchers/${done.id}`}>
              <Eye />
              عرض السند
            </Link>
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null)
              setV((p) => ({ ...blank(), date: p.date, cashAccountId: p.cashAccountId }))
              setStudent(null)
              setRefund(null)
            }}
          >
            <Plus />
            سند جديد
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {data.kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => switchKind(k)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-2xl border px-3 py-3 text-center transition-colors [&_svg]:size-5',
              kind === k ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {KIND_META[k].icon}
            <span className="text-sm font-semibold">{KIND_META[k].label}</span>
            <span className="text-[11px] leading-tight text-slate-500">{KIND_META[k].hint}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card space-y-4 p-5 lg:col-span-2">
          <h3 className="font-semibold text-slate-900">{KIND_META[kind].label}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {kind === 'EXPENSE' ? (
              <>
                <Field label="نوع المصروف" required error={fieldErrors.expenseAccountId}>
                  <Select value={v.expenseAccountId} onChange={set('expenseAccountId')}>
                    <option value="">اختر نوع المصروف</option>
                    {data.expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="اسم المستفيد" required error={fieldErrors.payeeName} hint="الجهة أو الشخص الذي استلم المبلغ">
                  <Input value={v.payeeName} onChange={set('payeeName')} placeholder="مثال: شركة الكهرباء" />
                </Field>
                {data.suppliers.length > 0 ? (
                  <Field label="المورد (اختياري)" hint="لربط المصروف النقدي بمورد في كشفه" className="sm:col-span-2">
                    <Select
                      value={v.expenseSupplierId}
                      onChange={(e) => {
                        const s = data.suppliers.find((x) => String(x.id) === e.target.value)
                        setV((p) => ({ ...p, expenseSupplierId: e.target.value, payeeName: p.payeeName || s?.name || '' }))
                      }}
                    >
                      <option value="">بدون</option>
                      {data.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </>
            ) : null}

            {kind === 'SUPPLIER_PAYMENT' ? (
              <>
                <Field
                  label="المورد"
                  required
                  error={fieldErrors.supplierId}
                  hint={supplier ? <>المستحق للمورد حاليًا: <b>{f.money(supplier.balance)}</b></> : undefined}
                  className="sm:col-span-2"
                >
                  <Select
                    value={v.supplierId}
                    onChange={(e) => {
                      const s = data.suppliers.find((x) => String(x.id) === e.target.value)
                      setV((p) => ({ ...p, supplierId: e.target.value, amount: s && D(s.balance).greaterThan(0) ? s.balance : p.amount }))
                    }}
                  >
                    <option value="">اختر المورد</option>
                    {data.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — المستحق {f.moneyText(s.balance)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {supplierOver ? (
                  <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
                    المبلغ أكبر من المستحق للمورد.
                    <Checkbox
                      className="mt-2"
                      checked={v.allowSupplierAdvance}
                      onChange={(e) => setV((p) => ({ ...p, allowSupplierAdvance: e.target.checked }))}
                      label="تسجيل الفرق كدفعة مقدمة للمورد"
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            {kind === 'CONTRACTOR_PAYMENT' ? (
              <Field
                label="العمل / الاتفاق"
                required
                error={fieldErrors.contractorJobId}
                hint={job ? <>قيمة الاتفاق {f.money(job.agreed)} — المدفوع {f.money(job.paid)} — المتبقي <b>{f.money(job.remaining)}</b></> : 'تظهر الأعمال المفتوحة التي عليها مبالغ متبقية'}
                className="sm:col-span-2"
              >
                <Select
                  value={v.contractorJobId}
                  onChange={(e) => {
                    const j = data.jobs.find((x) => String(x.id) === e.target.value)
                    setV((p) => ({ ...p, contractorJobId: e.target.value, amount: j ? j.remaining : p.amount }))
                  }}
                >
                  <option value="">اختر العمل</option>
                  {data.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.contractorName} — {j.description} (المتبقي {f.moneyText(j.remaining)})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {kind === 'SALARY' ? (
              <Field
                label="الموظف والشهر"
                required
                error={fieldErrors.payrollItemId}
                hint={payroll ? <>المتبقي من الراتب: <b>{f.money(payroll.remaining)}</b></> : 'تظهر رواتب المسيرات المعتمدة غير المصروفة بالكامل'}
                className="sm:col-span-2"
              >
                <Select
                  value={v.payrollItemId}
                  onChange={(e) => {
                    const p = data.payrollItems.find((x) => String(x.id) === e.target.value)
                    setV((prev) => ({ ...prev, payrollItemId: e.target.value, amount: p ? p.remaining : prev.amount }))
                  }}
                >
                  <option value="">اختر</option>
                  {data.payrollItems.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.runLabel} — {p.label} ({f.moneyText(p.remaining)})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {kind === 'STUDENT_REFUND' ? (
              <>
                <Field label="الطالب" required error={fieldErrors.studentId} className="sm:col-span-2">
                  <StudentPicker
                    value={student}
                    onChange={(s) => {
                      setStudent(s)
                      setRefund(null)
                      setV((p) => ({ ...p, payeeName: '', amount: '' }))
                    }}
                  />
                </Field>
                {student && refund ? (
                  <div className={cn('rounded-xl p-3 text-sm sm:col-span-2', D(refund.credit).greaterThan(0) ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>
                    {D(refund.credit).greaterThan(0) ? (
                      <>
                        الرصيد الدائن المتاح للإرجاع: <b>{f.money(refund.credit)}</b>
                      </>
                    ) : (
                      'لا يوجد رصيد دائن لهذا الطالب. لإرجاع مبلغ دُفع عن ذمة، ألغِ الذمة (أو جزءًا منها بخصم) أولًا فيتحول المدفوع إلى رصيد دائن.'
                    )}
                  </div>
                ) : null}
                <Field label="اسم المستلم" error={fieldErrors.payeeName} className="sm:col-span-2">
                  <Input value={v.payeeName} onChange={set('payeeName')} placeholder="ولي الأمر" />
                </Field>
              </>
            ) : null}

            {kind === 'PARTNER_WITHDRAWAL' ? (
              <Field label="الشريك" required error={fieldErrors.partnerId} className="sm:col-span-2">
                <Select value={v.partnerId} onChange={set('partnerId')}>
                  <option value="">اختر الشريك</option>
                  {data.partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {kind === 'OTHER' ? (
              <>
                <Field label="الحساب المدين" required error={fieldErrors.otherAccountId}>
                  <Select value={v.otherAccountId} onChange={set('otherAccountId')}>
                    <option value="">اختر الحساب</option>
                    {data.otherAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="اسم المستفيد" required error={fieldErrors.payeeName}>
                  <Input value={v.payeeName} onChange={set('payeeName')} />
                </Field>
              </>
            ) : null}

            <Field label="المبلغ" required error={fieldErrors.amount}>
              <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} large />
            </Field>
            <Field label="التاريخ" required error={fieldErrors.date}>
              <Input type="date" value={v.date} onChange={set('date')} />
            </Field>
            <Field label="البيان" className="sm:col-span-2" error={fieldErrors.description}>
              <Input value={v.description} onChange={set('description')} placeholder="وصف مختصر يظهر في السند والتقارير" />
            </Field>
            <Field label="ملاحظات" className="sm:col-span-2">
              <Textarea value={v.notes} onChange={set('notes')} rows={2} />
            </Field>
          </div>
        </div>

        <div className="card h-fit space-y-4 p-5">
          <h3 className="font-semibold text-slate-900">طريقة الدفع</h3>
          <Field label="الطريقة">
            <Select
              value={v.paymentMethod}
              onChange={(e) => {
                const method = e.target.value
                setV((p) => {
                  const next = { ...p, paymentMethod: method }
                  if (method === 'CHEQUE' && cash?.type !== 'BANK') next.cashAccountId = String(data.cashAccounts.find((c) => c.type === 'BANK')?.id ?? '')
                  return next
                })
              }}
            >
              {Object.entries(PAYMENT_METHOD).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={v.paymentMethod === 'CHEQUE' ? 'الحساب البنكي المسحوب عليه' : 'يُصرف من'}
            required
            error={fieldErrors.cashAccountId ?? (overCash ? 'المبلغ أكبر من الرصيد المتاح' : undefined)}
            hint={cash ? <>الرصيد المتاح: {f.money(cash.balance)}</> : undefined}
          >
            <Select value={v.cashAccountId} onChange={set('cashAccountId')}>
              {cashChoices.length === 0 ? <option value="">لا يوجد حساب بنكي</option> : null}
              {cashChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {v.paymentMethod === 'CHEQUE' ? (
            <>
              <Field label="رقم الشيك" required error={fieldErrors['cheque.number']}>
                <Input value={v.chequeNumber} onChange={set('chequeNumber')} dir="ltr" className="text-start" />
              </Field>
              <Field label="تاريخ استحقاق الشيك" required error={fieldErrors['cheque.dueDate']}>
                <Input type="date" value={v.chequeDue} onChange={set('chequeDue')} />
              </Field>
            </>
          ) : v.paymentMethod !== 'CASH' ? (
            <Field label="رقم المرجع / الحوالة">
              <Input value={v.referenceNumber} onChange={set('referenceNumber')} dir="ltr" className="text-start" />
            </Field>
          ) : null}
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">المبلغ</span>
              <b>{f.money(v.amount || 0)}</b>
            </div>
            {cash ? (
              <div className="mt-1 flex justify-between">
                <span className="text-slate-500">الرصيد بعد الصرف</span>
                <span className={overCash ? 'font-semibold text-rose-600' : ''}>{f.money(D(cash.balance).minus(amount))}</span>
              </div>
            ) : null}
          </div>
          <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!!overCash || (!!supplierOver && !v.allowSupplierAdvance)}>
            {!pending ? <Save /> : null}
            حفظ سند الصرف
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <HandCoins className="size-3.5" />
            يأخذ السند رقمًا تلقائيًا ويُخصم المبلغ من الصندوق فورًا.
          </p>
        </div>
      </div>
    </form>
  )
}
