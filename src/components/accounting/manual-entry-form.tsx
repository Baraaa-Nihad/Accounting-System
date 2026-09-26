'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Scale, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { D, parseAmountInput } from '@/lib/money'
import { ACCOUNT_TYPE } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { createManualEntryAction } from '@/app/(app)/accounting/actions'

export interface PostingAccount {
  id: number
  code: string
  name: string
  type: string
}

interface Line {
  key: number
  accountId: string
  debit: string
  credit: string
  description: string
}

let seq = 0
const newLine = (): Line => ({ key: ++seq, accountId: '', debit: '', credit: '', description: '' })

/** قيد يدوي متعدد الأسطر: يُمنع الحفظ حتى يتوازن المدين والدائن. */
export function ManualEntryForm({ accounts }: { accounts: PostingAccount[] }) {
  const router = useRouter()
  const { today } = useApp()
  const f = useFormat()
  const [date, setDate] = React.useState(today)
  const [description, setDescription] = React.useState('')
  const [lines, setLines] = React.useState<Line[]>(() => [newLine(), newLine()])
  const { run, pending, fieldErrors } = useAction(createManualEntryAction, { refresh: false, onSuccess: (d) => router.push(`/accounting/journal/${d.id}`) })
  const amount = (s: string) => parseAmountInput(s) ?? D(0)
  const totalDebit = lines.reduce((a, l) => a.plus(amount(l.debit)), D(0))
  const totalCredit = lines.reduce((a, l) => a.plus(amount(l.credit)), D(0))
  const diff = totalDebit.minus(totalCredit)
  const balanced = diff.isZero() && totalDebit.greaterThan(0)
  const groups = Object.keys(ACCOUNT_TYPE)
    .map((t) => ({ type: t, items: accounts.filter((a) => a.type === t) }))
    .filter((g) => g.items.length)
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="card p-5">
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Field label="التاريخ" required error={fieldErrors.date}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="بيان القيد" required error={fieldErrors.description} className="sm:col-span-3">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: إهلاك الأجهزة لشهر أيلول" />
        </Field>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2 text-start text-xs font-semibold">#</th>
              <th className="px-2 py-2 text-start text-xs font-semibold">الحساب</th>
              <th className="w-40 px-2 py-2 text-start text-xs font-semibold">مدين</th>
              <th className="w-40 px-2 py-2 text-start text-xs font-semibold">دائن</th>
              <th className="px-2 py-2 text-start text-xs font-semibold">بيان السطر (اختياري)</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="align-top">
                <td className="num px-2 py-1.5 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <Select value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })} aria-label={`حساب السطر ${i + 1}`}>
                    <option value="">اختر الحساب</option>
                    {groups.map((g) => (
                      <optgroup key={g.type} label={ACCOUNT_TYPE[g.type]}>
                        {g.items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <MoneyInput value={l.debit} onChange={(v) => update(l.key, { debit: v, credit: v ? '' : l.credit })} showSymbol={false} aria-label={`مدين السطر ${i + 1}`} />
                </td>
                <td className="px-2 py-1.5">
                  <MoneyInput value={l.credit} onChange={(v) => update(l.key, { credit: v, debit: v ? '' : l.debit })} showSymbol={false} aria-label={`دائن السطر ${i + 1}`} />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                </td>
                <td className="px-1 py-1.5">
                  <Button variant="ghost" size="icon-sm" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="حذف السطر">
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td />
              <td className="px-2 py-2">
                <Button variant="soft" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                  <Plus />
                  سطر
                </Button>
              </td>
              <td className="px-2 py-2">{f.money(totalDebit.toString())}</td>
              <td className="px-2 py-2">{f.money(totalCredit.toString())}</td>
              <td colSpan={2} className="px-2 py-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs', balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                  <Scale className="size-3.5" />
                  {balanced ? 'متوازن' : totalDebit.isZero() && totalCredit.isZero() ? 'أدخل المبالغ' : <>الفرق {f.money(diff.abs().toString())}</>}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        القيود اليدوية للتسويات فقط (إهلاك، إعادة تصنيف، تصحيح). الحركات النقدية تُسجل بسندات القبض والصرف، وحسابات الطلاب والموردين والمقاولين والموظفين والشركاء تتحرك من شاشاتها حتى تبقى كشوف حساباتهم صحيحة.
      </p>
      <div className="mt-5 flex justify-end">
        <Button
          size="lg"
          loading={pending}
          disabled={!balanced}
          onClick={() =>
            run({
              date,
              description,
              lines: lines.filter((l) => l.accountId && (l.debit || l.credit)).map((l) => ({ accountId: l.accountId, debit: l.debit || null, credit: l.credit || null, description: l.description || null })),
            })
          }
        >
          ترحيل القيد
        </Button>
      </div>
    </div>
  )
}
