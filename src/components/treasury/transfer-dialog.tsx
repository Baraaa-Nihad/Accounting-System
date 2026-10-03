'use client'

import * as React from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createTransferAction } from '@/app/(app)/treasury/actions'
import { D } from '@/lib/money'

export interface TransferAccount {
  id: number
  name: string
  balance: string
}

/**
 * تحويل مبلغ بين الصناديق والبنوك (إيداع نقدية في البنك، سحب من البنك...).
 * fromIds: الحسابات المسموح التحويل منها (لصاحب العهدة: صناديقه فقط)، والتحويل إليها مفتوح.
 */
export function TransferDialog({
  accounts,
  defaultFromId,
  fromIds,
  trigger,
}: {
  accounts: TransferAccount[]
  defaultFromId?: number
  fromIds?: number[]
  trigger?: React.ReactNode
}) {
  const { today } = useApp()
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const sources = fromIds ? accounts.filter((a) => fromIds.includes(a.id)) : accounts
  const initial = () => {
    // الافتراضي: الحساب المحدد، وإلا صاحب أكبر رصيد
    const richest = [...sources].sort((a, b) => Number(b.balance) - Number(a.balance))[0]
    const from = defaultFromId && sources.some((a) => a.id === defaultFromId) ? defaultFromId : richest?.id
    return {
      fromAccountId: String(from ?? ''),
      toAccountId: String(accounts.find((a) => a.id !== from)?.id ?? ''),
      amount: '',
      date: today,
      description: '',
    }
  }
  const [v, setV] = React.useState(initial)
  const { run, pending, fieldErrors } = useAction(createTransferAction, { onSuccess: () => setOpen(false) })
  const from = accounts.find((a) => String(a.id) === v.fromAccountId)
  const over = from && v.amount && D(v.amount).greaterThan(D(from.balance))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setV(initial())
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="lg">
            <ArrowLeftRight />
            تحويل مبلغ
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="تحويل بين الصناديق والبنوك"
        description="مثال: إيداع نقدية الصندوق في البنك. لا يؤثر التحويل على الإيرادات أو المصروفات."
        footer={
          <Button loading={pending} disabled={!!over} onClick={() => run(v)}>
            تنفيذ التحويل
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="من" required error={fieldErrors.fromAccountId} hint={from ? <>الرصيد المتاح: {f.money(from.balance)}</> : undefined}>
            <Select value={v.fromAccountId} onChange={(e) => setV((p) => ({ ...p, fromAccountId: e.target.value }))}>
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="إلى" required error={fieldErrors.toAccountId}>
            <Select value={v.toAccountId} onChange={(e) => setV((p) => ({ ...p, toAccountId: e.target.value }))}>
              <option value="">اختر</option>
              {accounts
                .filter((a) => String(a.id) !== v.fromAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="المبلغ" required error={fieldErrors.amount ?? (over ? 'أكبر من الرصيد المتاح' : undefined)}>
            <MoneyInput value={v.amount} onChange={(x) => setV((p) => ({ ...p, amount: x }))} large />
          </Field>
          <Field label="التاريخ" required error={fieldErrors.date}>
            <Input type="date" value={v.date} onChange={(e) => setV((p) => ({ ...p, date: e.target.value }))} />
          </Field>
          <Field label="البيان" className="sm:col-span-2">
            <Input value={v.description} onChange={(e) => setV((p) => ({ ...p, description: e.target.value }))} placeholder="مثال: إيداع نقدية الأسبوع" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
