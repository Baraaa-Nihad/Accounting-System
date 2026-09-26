'use client'

import * as React from 'react'
import Link from 'next/link'
import { Eye, Layers, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field, FormSection } from '@/components/ui/field'
import { MoneyInput } from '@/components/forms/money-input'
import { Badge } from '@/components/ui/badge'
import { useApp, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { createBulkAction, previewBulkAction } from '@/app/(app)/charges/actions'
import type { BulkPreviewRow } from '@/server/services/charges'
import { D, sum } from '@/lib/money'
import { cn } from '@/lib/utils'

export function BulkChargeForm({
  years,
  chargeTypes,
  grades,
  defaultYearId,
}: {
  years: { id: number; name: string; status: string }[]
  chargeTypes: { id: number; name: string }[]
  grades: { id: number; name: string }[]
  defaultYearId: number | null
}) {
  const { today } = useApp()
  const f = useFormat()
  const [v, setV] = React.useState({
    academicYearId: String(defaultYearId ?? ''),
    chargeTypeId: '',
    gradeIds: [] as number[],
    useFeePlan: true,
    amount: '',
    date: today,
    dueDate: today,
    installOn: false,
    count: '8',
    firstDueDate: today,
    dueDay: '',
    description: '',
    applyRules: true,
  })
  const [preview, setPreview] = React.useState<BulkPreviewRow[] | null>(null)
  const [result, setResult] = React.useState<{ created: number; skipped: number; total: string } | null>(null)
  const payload = () => ({
    academicYearId: v.academicYearId,
    chargeTypeId: v.chargeTypeId,
    gradeIds: v.gradeIds,
    useFeePlan: v.useFeePlan,
    amount: v.useFeePlan ? null : v.amount,
    date: v.date,
    dueDate: v.installOn ? null : v.dueDate,
    installments: !v.useFeePlan && v.installOn ? { count: v.count, firstDueDate: v.firstDueDate, dueDay: v.dueDay } : null,
    description: v.description,
    applyRules: v.applyRules,
  })
  const prev = useAction(previewBulkAction, { refresh: false, onSuccess: (rows) => setPreview(rows) })
  const create = useAction(createBulkAction, { onSuccess: (r) => setResult(r) })
  const reset = () => setPreview(null)

  if (result) {
    return (
      <div className="card flex flex-col items-center p-10 text-center">
        <CheckCircle2 className="mb-3 size-12 text-emerald-600" />
        <p className="text-lg font-bold">تم إصدار {result.created} ذمة بإجمالي {f.money(result.total)}</p>
        <p className="text-slate-500">تم تجاوز {result.skipped} طالبًا (لديهم نفس الذمة أو لا توجد رسوم مقررة لصفهم).</p>
        <div className="mt-5 flex gap-2">
          <Button asChild>
            <Link href="/charges">عرض الذمم</Link>
          </Button>
          <Button variant="secondary" onClick={() => { setResult(null); setPreview(null) }}>
            إصدار آخر
          </Button>
        </div>
      </div>
    )
  }

  const toCreate = preview?.filter((p) => !p.skip) ?? []
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5">
        <FormSection title="ما الذي سيُصدر؟">
          <div className="space-y-4">
            <Field label="السنة الدراسية" required>
              <Select value={v.academicYearId} onChange={(e) => { setV({ ...v, academicYearId: e.target.value }); reset() }}>
                {years.map((y) => (
                  <option key={y.id} value={y.id} disabled={y.status === 'CLOSED'}>
                    {y.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="نوع الذمة" required error={prev.fieldErrors.chargeTypeId}>
              <Select value={v.chargeTypeId} onChange={(e) => { setV({ ...v, chargeTypeId: e.target.value }); reset() }}>
                <option value="">اختر النوع</option>
                {chargeTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الصفوف" hint="اترك الكل غير محدد لإصدارها لكل الصفوف">
              <div className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
                {grades.map((g) => (
                  <Checkbox
                    key={g.id}
                    className="flex"
                    checked={v.gradeIds.includes(g.id)}
                    onChange={(e) => {
                      setV({ ...v, gradeIds: e.target.checked ? [...v.gradeIds, g.id] : v.gradeIds.filter((x) => x !== g.id) })
                      reset()
                    }}
                    label={g.name}
                  />
                ))}
              </div>
            </Field>
          </div>
        </FormSection>
        <FormSection title="المبلغ والتقسيط">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[true, false].map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  onClick={() => { setV({ ...v, useFeePlan: b }); reset() }}
                  className={cn('rounded-xl border px-3 py-2.5 text-sm font-medium', v.useFeePlan === b ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600')}
                >
                  {b ? 'حسب الرسوم المقررة لكل صف' : 'مبلغ موحد'}
                </button>
              ))}
            </div>
            {!v.useFeePlan ? (
              <>
                <Field label="المبلغ لكل طالب" required>
                  <MoneyInput value={v.amount} onChange={(x) => { setV({ ...v, amount: x }); reset() }} />
                </Field>
                <Checkbox checked={v.installOn} onChange={(e) => setV({ ...v, installOn: e.target.checked })} label="تقسيط" />
                {v.installOn ? (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="العدد">
                      <Input value={v.count} onChange={(e) => setV({ ...v, count: e.target.value.replace(/\D/g, '') })} dir="ltr" className="num text-left" />
                    </Field>
                    <Field label="أول قسط" className="col-span-2">
                      <Input type="date" value={v.firstDueDate} onChange={(e) => setV({ ...v, firstDueDate: e.target.value })} />
                    </Field>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">
                يُستخدم مبلغ وجدول أقساط كل صف من صفحة{' '}
                <Link href="/charges/fee-plans" className="text-brand-700">
                  الرسوم المقررة
                </Link>
                .
              </p>
            )}
            <Field label="تاريخ الذمة">
              <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
            </Field>
            {!v.installOn ? (
              <Field label="تاريخ الاستحقاق (إن لم تكن مقسطة)">
                <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
              </Field>
            ) : null}
            <Field label="البيان">
              <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="اختياري" />
            </Field>
            <Checkbox checked={v.applyRules} onChange={(e) => setV({ ...v, applyRules: e.target.checked })} label="تطبيق الخصومات الدائمة (مثل خصم الإخوة)" />
          </div>
        </FormSection>
        <Button size="lg" className="w-full" variant="secondary" loading={prev.pending} onClick={() => prev.run(payload())}>
          {!prev.pending ? <Eye /> : null}
          معاينة قبل الإصدار
        </Button>
      </div>
      <div className="lg:col-span-2">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="font-semibold text-slate-900">المعاينة</h3>
              <p className="text-sm text-slate-500">
                {preview
                  ? `سيتم إصدار ${toCreate.length} ذمة بإجمالي ${f.moneyText(sum(toCreate.map((p) => p.amount ?? '0')))} — تجاوز ${preview.length - toCreate.length}`
                  : 'اضغط «معاينة» لعرض الطلاب قبل الإصدار. لا يُحفظ شيء قبل التأكيد.'}
              </p>
            </div>
            {preview && toCreate.length > 0 ? (
              <Button size="lg" loading={create.pending} onClick={() => create.run(payload())}>
                {!create.pending ? <Layers /> : null}
                تأكيد الإصدار ({toCreate.length})
              </Button>
            ) : null}
          </div>
          {preview ? (
            <div className="scroll-thin max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-start">الطالب</th>
                    <th className="px-4 py-2 text-start">الصف</th>
                    <th className="px-4 py-2 text-end">المبلغ</th>
                    <th className="px-4 py-2 text-start">الأقساط</th>
                    <th className="px-4 py-2 text-start">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.studentId} className={cn('border-t border-slate-100', p.skip && 'text-slate-400')}>
                      <td className="px-4 py-1.5">
                        {p.studentName} <span className="text-xs">({p.studentNumber})</span>
                      </td>
                      <td className="px-4 py-1.5">{p.gradeName}</td>
                      <td className="px-4 py-1.5 text-end">{p.amount ? f.money(p.amount) : '—'}</td>
                      <td className="px-4 py-1.5">{p.installments > 1 ? `${p.installments} أقساط` : 'دفعة واحدة'}</td>
                      <td className="px-4 py-1.5">
                        {p.skip ? <Badge tone="gray">{p.skipReason}</Badge> : p.rulesCount ? <Badge tone="teal">{p.rulesCount} خصم دائم</Badge> : null}
                      </td>
                    </tr>
                  ))}
                  {preview.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                        لا يوجد طلاب مسجلون في الصفوف المختارة لهذه السنة
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        {preview && D(sum(toCreate.map((p) => p.amount ?? '0'))).isZero() && toCreate.length > 0 ? <p className="mt-2 text-sm text-rose-600">تحقق من المبالغ</p> : null}
      </div>
    </div>
  )
}
