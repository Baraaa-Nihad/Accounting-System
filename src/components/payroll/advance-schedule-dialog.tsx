'use client'

import * as React from 'react'
import { CalendarCog } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { updateAdvanceAction } from '@/app/(app)/payroll/actions'
import { ARABIC_MONTHS } from '@/lib/dates'

/** تعديل القسط الشهري أو شهر بدء الخصم لسلفة قائمة. */
export function AdvanceScheduleDialog({ advance }: { advance: { id: number; employeeName: string; monthlyDeduction: string; startYear: number; startMonth: number; remaining: string } }) {
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const [v, setV] = React.useState({ monthlyDeduction: advance.monthlyDeduction, startYear: String(advance.startYear), startMonth: String(advance.startMonth), reason: '' })
  const { run, pending, fieldErrors } = useAction(updateAdvanceAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700" title="تعديل جدول الخصم">
        <CalendarCog className="size-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`تعديل خصم سلفة ${advance.employeeName}`}
          description={`المتبقي من السلفة: ${f.moneyText(advance.remaining)}. تتحدث مسودات الرواتب تلقائيًا.`}
          size="sm"
          footer={
            <Button loading={pending} onClick={() => run({ id: advance.id, ...v })}>
              حفظ
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="القسط الشهري" required error={fieldErrors.monthlyDeduction} className="sm:col-span-2">
              <MoneyInput value={v.monthlyDeduction} onChange={(x) => setV((p) => ({ ...p, monthlyDeduction: x }))} />
            </Field>
            <Field label="يبدأ من شهر" error={fieldErrors.startMonth}>
              <Select value={v.startMonth} onChange={(e) => setV((p) => ({ ...p, startMonth: e.target.value }))}>
                {ARABIC_MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} — {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السنة" error={fieldErrors.startYear}>
              <Input value={v.startYear} onChange={(e) => setV((p) => ({ ...p, startYear: e.target.value.replace(/\D/g, '') }))} dir="ltr" className="text-center" />
            </Field>
            <Field label="سبب التعديل" required error={fieldErrors.reason} className="sm:col-span-2">
              <Input value={v.reason} onChange={(e) => setV((p) => ({ ...p, reason: e.target.value }))} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
