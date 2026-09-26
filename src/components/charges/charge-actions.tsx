'use client'

import * as React from 'react'
import Link from 'next/link'
import { MoreHorizontal, Eye, CalendarClock, Ban, BadgePercent } from 'lucide-react'
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp, useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { cancelChargeAction, rescheduleChargeAction } from '@/app/(app)/charges/actions'
import { buildSchedule } from '@/lib/schedule'
import { D } from '@/lib/money'

export function ChargeActions({
  chargeId,
  remaining,
  paid,
  cancelled,
  onDiscount,
}: {
  chargeId: number
  remaining: string
  paid: string
  cancelled?: boolean
  onDiscount?: () => void
}) {
  const can = useCan()
  const f = useFormat()
  const { today, format } = useApp()
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [resOpen, setResOpen] = React.useState(false)
  const [count, setCount] = React.useState('4')
  const [first, setFirst] = React.useState(today)
  const [day, setDay] = React.useState('')
  const cancel = useAction(cancelChargeAction, { onSuccess: () => setCancelOpen(false) })
  const resched = useAction(rescheduleChargeAction, { onSuccess: () => setResOpen(false) })
  const rem = D(remaining)
  const preview = React.useMemo(() => {
    const n = Number(count)
    if (!rem.greaterThan(0) || !n || n < 1 || n > 60 || !first) return []
    return buildSchedule(rem, n, first, format.decimals, day ? Number(day) : null)
  }, [rem, count, first, day, format.decimals])

  return (
    <>
      <Dropdown>
        <DropdownTrigger className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إجراءات">
          <MoreHorizontal className="size-5" />
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem asChild>
            <Link href={`/charges/${chargeId}`}>
              <Eye />
              تفاصيل الذمة والأقساط
            </Link>
          </DropdownItem>
          {!cancelled && onDiscount && can('discounts.create') && rem.greaterThan(0) ? (
            <DropdownItem onSelect={onDiscount}>
              <BadgePercent />
              خصم على هذه الذمة
            </DropdownItem>
          ) : null}
          {!cancelled && can('charges.edit') && rem.greaterThan(0) ? (
            <DropdownItem onSelect={() => setResOpen(true)}>
              <CalendarClock />
              إعادة جدولة الأقساط
            </DropdownItem>
          ) : null}
          {!cancelled && can('charges.cancel') ? (
            <>
              <DropdownSeparator />
              <DropdownItem danger onSelect={() => setCancelOpen(true)}>
                <Ban />
                إلغاء الذمة
              </DropdownItem>
            </>
          ) : null}
        </DropdownContent>
      </Dropdown>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="إلغاء الذمة"
        description="تبقى الذمة محفوظة بحالة «ملغاة» ويُعكس قيدها المحاسبي."
        confirmLabel="إلغاء الذمة"
        danger
        requireReason
        pending={cancel.pending}
        onConfirm={(reason) => cancel.run({ id: chargeId, reason })}
      >
        {D(paid).greaterThan(0) ? (
          <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            دُفع من هذه الذمة {f.money(paid)}. بعد الإلغاء يتحول هذا المبلغ إلى <b>رصيد دائن للطالب</b> يمكن تطبيقه على ذمم أخرى أو رده.
          </p>
        ) : null}
      </ConfirmDialog>

      <Dialog open={resOpen} onOpenChange={setResOpen}>
        <DialogContent
          title="إعادة جدولة الأقساط"
          description={`المبلغ غير المدفوع ${f.moneyText(rem)} يُقسم على جدول جديد. الأقساط المدفوعة لا تتغير.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResOpen(false)}>
                إلغاء
              </Button>
              <Button loading={resched.pending} onClick={() => resched.run({ chargeId, count, firstDueDate: first, dueDay: day })}>
                حفظ الجدول الجديد
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="عدد الأقساط">
              <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} dir="ltr" className="num text-left" />
            </Field>
            <Field label="تاريخ أول قسط">
              <Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </Field>
            <Field label="يوم الاستحقاق">
              <Input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="تلقائي" dir="ltr" className="num text-left" />
            </Field>
          </div>
          {preview.length ? (
            <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {preview.map((l, i) => (
                <li key={i} className="flex justify-between px-3 py-1.5">
                  <span className="text-slate-500">قسط {i + 1} — {f.date(l.dueDate)}</span>
                  {f.money(l.amount)}
                </li>
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
