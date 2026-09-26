'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Calculator } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { useApp } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createRunAction } from '@/app/(app)/payroll/actions'
import { ARABIC_MONTHS, endOfMonth, makeDate, parts } from '@/lib/dates'

/** احتساب رواتب شهر: ينشئ مسودة لكل الموظفين الفعالين. */
export function NewRunDialog({ taken }: { taken: string[] }) {
  const router = useRouter()
  const { today } = useApp()
  const [open, setOpen] = React.useState(false)
  const t = parts(today)
  const [v, setV] = React.useState({ year: String(t.y), month: String(t.m), postingDate: '' })
  const { run, pending, fieldErrors } = useAction(createRunAction, { onSuccess: (d) => router.push(`/payroll/${d.id}`) })
  const monthEndDate = endOfMonth(makeDate(Number(v.year), Number(v.month), 1))
  const exists = taken.includes(`${v.year}-${v.month}`)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg">
          <Calculator />
          احتساب رواتب الشهر
        </Button>
      </DialogTrigger>
      <DialogContent
        title="احتساب رواتب شهر"
        description="تُنشأ مسودة لكل الموظفين الفعالين تتضمن الراتب، الإضافي المسجل، وأقساط السلف المستحقة. يمكنك تعديلها قبل الاعتماد."
        size="sm"
        footer={
          <Button loading={pending} disabled={exists} onClick={() => run({ year: v.year, month: v.month, postingDate: v.postingDate || null })}>
            احتساب
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الشهر" required error={fieldErrors.month ?? (exists ? 'يوجد مسير لهذا الشهر' : undefined)}>
            <Select value={v.month} onChange={(e) => setV((p) => ({ ...p, month: e.target.value }))}>
              {ARABIC_MONTHS.map((name, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} — {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="السنة" required error={fieldErrors.year}>
            <Input value={v.year} onChange={(e) => setV((p) => ({ ...p, year: e.target.value.replace(/\D/g, '') }))} dir="ltr" className="text-center" inputMode="numeric" />
          </Field>
          <Field label="تاريخ قيد الرواتب" hint={`الافتراضي: آخر الشهر (${monthEndDate})، أو اليوم إن لم ينته الشهر. لا يُصرف راتب قبل هذا التاريخ.`} className="sm:col-span-2" error={fieldErrors.postingDate}>
            <Input type="date" value={v.postingDate} onChange={(e) => setV((p) => ({ ...p, postingDate: e.target.value }))} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
