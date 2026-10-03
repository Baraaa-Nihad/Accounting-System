'use client'

import * as React from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createCashAccountAction, updateCashAccountAction } from '@/app/(app)/treasury/actions'

export interface CashAccountFormValue {
  id: number
  name: string
  type: 'CASHBOX' | 'BANK'
  bankName: string
  accountNumber: string
  iban: string
  lowBalanceAlert: string
  isDefault: boolean
  isActive: boolean
  notes: string
  /** صاحب العهدة: '' أو 'u:رقم المستخدم' أو 'p:رقم الشريك' */
  custody: string
}

export interface CustodyPeople {
  users: { id: number; label: string }[]
  partners: { id: number; label: string }[]
}

/** يحول قيمة اختيار العهدة إلى المعرّفين المرسلين للخادم. */
function custodyIds(custody: string) {
  const [kind, raw] = custody.split(':')
  const id = Number(raw)
  return { custodianId: kind === 'u' && id ? id : null, partnerId: kind === 'p' && id ? id : null }
}

export function CashAccountDialog({ initial, people }: { initial?: CashAccountFormValue; people: CustodyPeople }) {
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const empty = {
    name: '',
    type: 'CASHBOX' as 'CASHBOX' | 'BANK',
    bankName: '',
    accountNumber: '',
    iban: '',
    lowBalanceAlert: '',
    isDefault: false,
    isActive: true,
    notes: '',
    custody: '',
    openingBalance: '',
    openingDate: today,
  }
  const [v, setV] = React.useState(initial ? { ...empty, ...initial } : empty)
  const create = useAction(createCashAccountAction, { onSuccess: () => setOpen(false) })
  const update = useAction(updateCashAccountAction, { onSuccess: () => setOpen(false) })
  const pending = create.pending || update.pending
  const errors = initial ? update.fieldErrors : create.fieldErrors
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))

  const submit = () => {
    const common = {
      name: v.name,
      bankName: v.type === 'BANK' ? v.bankName : null,
      accountNumber: v.type === 'BANK' ? v.accountNumber : null,
      iban: v.type === 'BANK' ? v.iban : null,
      lowBalanceAlert: v.lowBalanceAlert || null,
      isDefault: v.isDefault,
      notes: v.notes,
      ...custodyIds(v.type === 'CASHBOX' ? v.custody : ''),
    }
    if (initial) update.run({ id: initial.id, ...common, isActive: v.isActive })
    else create.run({ ...common, type: v.type, openingBalance: v.openingBalance || null, openingDate: v.openingDate })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(initial ? { ...empty, ...initial } : empty)
      }}
    >
      <DialogTrigger asChild>
        {initial ? (
          <Button variant="ghost" size="sm">
            <Pencil />
            تعديل
          </Button>
        ) : (
          <Button variant="secondary">
            <Plus />
            صندوق / حساب بنكي
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={initial ? `تعديل ${initial.name}` : 'إضافة صندوق أو حساب بنكي'}
        description={initial ? undefined : 'يُنشأ حسابه في دليل الحسابات تلقائيًا. الرصيد الافتتاحي يُسجل بقيد «أرصدة افتتاحية».'}
        footer={
          <Button loading={pending} onClick={submit}>
            حفظ
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!initial ? (
            <Field label="النوع" required className="sm:col-span-2">
              <div className="flex gap-2">
                {(['CASHBOX', 'BANK'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setV((p) => ({ ...p, type: t }))}
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium ${v.type === t ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t === 'CASHBOX' ? 'صندوق نقدي' : 'حساب بنكي'}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label="الاسم" required error={errors.name} className="sm:col-span-2">
            <Input value={v.name} onChange={set('name')} placeholder={v.type === 'CASHBOX' ? 'مثال: صندوق الإدارة' : 'مثال: بنك فلسطين — الحساب الجاري'} />
          </Field>
          {v.type === 'CASHBOX' ? (
            <Field
              label="في عهدة"
              error={errors.custodianId ?? errors.partnerId}
              hint="صاحب العهدة يقبض ويصرف من صندوقه فقط، إلا من لديه صلاحية «القبض والصرف من كل الصناديق»"
              className="sm:col-span-2"
            >
              <Select value={v.custody} onChange={set('custody')}>
                <option value="">بلا عهدة (صندوق عام)</option>
                {people.users.length ? (
                  <optgroup label="الموظفون (المستخدمون)">
                    {people.users.map((u) => (
                      <option key={u.id} value={`u:${u.id}`}>
                        {u.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {people.partners.length ? (
                  <optgroup label="الشركاء">
                    {people.partners.map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
            </Field>
          ) : null}
          {v.type === 'BANK' ? (
            <>
              <Field label="اسم البنك">
                <Input value={v.bankName} onChange={set('bankName')} />
              </Field>
              <Field label="رقم الحساب">
                <Input value={v.accountNumber} onChange={set('accountNumber')} dir="ltr" className="text-start" />
              </Field>
              <Field label="IBAN" className="sm:col-span-2">
                <Input value={v.iban} onChange={set('iban')} dir="ltr" className="text-start" />
              </Field>
            </>
          ) : null}
          {!initial ? (
            <>
              <Field label="الرصيد الافتتاحي" error={errors.openingBalance} hint="المبلغ الموجود فعليًا عند بدء استخدام النظام">
                <MoneyInput value={v.openingBalance} onChange={(x) => setV((p) => ({ ...p, openingBalance: x }))} />
              </Field>
              <Field label="تاريخ الرصيد الافتتاحي" error={errors.openingDate}>
                <Input type="date" value={v.openingDate} onChange={set('openingDate')} />
              </Field>
            </>
          ) : null}
          <Field label="تنبيه عند انخفاض الرصيد عن" hint="اتركه فارغًا لاستخدام الحد العام من الإعدادات">
            <MoneyInput value={v.lowBalanceAlert} onChange={(x) => setV((p) => ({ ...p, lowBalanceAlert: x }))} />
          </Field>
          <div className="flex flex-col justify-center gap-2">
            <Checkbox checked={v.isDefault} onChange={(e) => setV((p) => ({ ...p, isDefault: e.target.checked }))} label="الافتراضي في السندات" />
            {initial ? <Checkbox checked={v.isActive} onChange={(e) => setV((p) => ({ ...p, isActive: e.target.checked }))} label="فعال" description="لا يمكن تعطيل حساب رصيده غير صفر" /> : null}
          </div>
          <Field label="ملاحظات" className="sm:col-span-2">
            <Textarea value={v.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

