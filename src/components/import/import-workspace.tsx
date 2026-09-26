'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Checkbox, Select } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { cn } from '@/lib/utils'
import { commitImportAction, discardImportAction, saveImportSettingsAction } from '@/app/(app)/import/actions'

export interface WorkspaceField {
  key: string
  label: string
  required: boolean
  help: string
}

export interface WorkspaceOptions {
  yearId: number | null
  duplicates: 'skip' | 'update'
  createMissing: boolean
  cashAccountId: number | null
}

/** حرف عمود Excel: 0 ← A، 26 ← AA */
function columnLetter(i: number) {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** ربط الأعمدة والخيارات والتأكيد (الخطوات 3–5). نتيجة التحقق تأتي من الخادم كـ children. */
export function ImportWorkspace({
  batchId,
  typeLabel,
  fields,
  headers,
  samples,
  mapping,
  options,
  flags,
  years,
  cashAccounts,
  summary,
  lastError,
  children,
}: {
  batchId: number
  typeLabel: string
  fields: WorkspaceField[]
  headers: string[]
  samples: string[][]
  mapping: Record<string, number | null>
  options: WorkspaceOptions
  flags: { supportsUpdate: boolean; supportsCreateMissing: boolean; needsYear: boolean; needsCashAccount: boolean }
  years: { id: number; name: string; open: boolean }[]
  cashAccounts: { id: number; name: string }[]
  summary: { total: number; valid: number; duplicate: number; error: number; toCreate: number; toUpdate: number }
  lastError: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const [map, setMap] = React.useState<Record<string, number | null>>(mapping)
  const [opts, setOpts] = React.useState<WorkspaceOptions>(options)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const save = useAction(saveImportSettingsAction)
  const commit = useAction(commitImportAction, { onSuccess: () => setConfirmOpen(false) })
  const discard = useAction(discardImportAction, { refresh: false, onSuccess: () => router.push('/import') })

  const dirty =
    fields.some((f) => (map[f.key] ?? null) !== (mapping[f.key] ?? null)) ||
    opts.yearId !== options.yearId ||
    opts.duplicates !== options.duplicates ||
    opts.createMissing !== options.createMissing ||
    opts.cashAccountId !== options.cashAccountId
  const used = new Map<number, string>()
  for (const f of fields) {
    const idx = map[f.key]
    if (idx !== null && idx !== undefined) used.set(idx, f.key)
  }
  const unmapped = headers.map((h, i) => ({ h, i })).filter((x) => !used.has(x.i))
  const missingRequired = fields.filter((f) => f.required && (map[f.key] === null || map[f.key] === undefined))
  const toImport = summary.toCreate + summary.toUpdate

  return (
    <>
      {lastError ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">فشلت المحاولة السابقة ولم يُحفظ أي شيء</p>
            <p className="mt-0.5">{lastError}</p>
          </div>
        </div>
      ) : null}
      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="ربط الأعمدة"
            description="اختر لكل حقل العمود المقابل في ملفك. تم الربط تلقائيًا حسب أسماء الأعمدة؛ عدّل ما يلزم."
          />
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-start text-xs font-semibold">حقل النظام</th>
                  <th className="px-4 py-2.5 text-start text-xs font-semibold">العمود في الملف</th>
                  <th className="px-4 py-2.5 text-start text-xs font-semibold">أمثلة من الملف</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const idx = map[f.key]
                  const sample = idx !== null && idx !== undefined ? samples[idx] ?? [] : []
                  const missing = f.required && (idx === null || idx === undefined)
                  return (
                    <tr key={f.key} className={cn('border-b border-slate-100 last:border-0', missing && 'bg-rose-50/60')}>
                      <td className="px-4 py-2 align-middle">
                        <span className="font-medium text-slate-800">
                          {f.label}
                          {f.required ? <span className="ms-0.5 text-rose-500">*</span> : null}
                        </span>
                        <span className="block text-xs text-slate-500">{f.help}</span>
                      </td>
                      <td className="min-w-56 px-4 py-2 align-middle">
                        <Select
                          aria-label={`عمود ${f.label}`}
                          value={idx === null || idx === undefined ? '' : String(idx)}
                          aria-invalid={missing || undefined}
                          disabled={save.pending}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value)
                            setMap((m) => {
                              const next = { ...m }
                              // العمود الواحد يُربط بحقل واحد فقط
                              if (v !== null) for (const k of Object.keys(next)) if (next[k] === v) next[k] = null
                              next[f.key] = v
                              return next
                            })
                          }}
                        >
                          <option value="">— غير موجود في الملف —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {columnLetter(i)}: {h || '(بدون عنوان)'}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="max-w-72 px-4 py-2 align-middle text-slate-600">
                        {sample.length ? (
                          <span className="line-clamp-2">
                            {sample.map((x, i) => (
                              <React.Fragment key={i}>
                                {i > 0 ? <span className="mx-1 text-slate-300">|</span> : null}
                                <bdi>{x}</bdi>
                              </React.Fragment>
                            ))}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="خيارات الاستيراد" />
            <CardBody className="space-y-4">
              {flags.needsYear ? (
                <Field label="السنة الدراسية" required hint="تُسجل البيانات المستوردة ضمن هذه السنة">
                  <Select value={opts.yearId ?? ''} onChange={(e) => setOpts((o) => ({ ...o, yearId: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">اختر السنة</option>
                    {years.map((y) => (
                      <option key={y.id} value={y.id} disabled={!y.open}>
                        {y.name}
                        {y.open ? '' : ' (مغلقة)'}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {flags.needsCashAccount ? (
                <Field label="الصندوق الافتراضي" required hint="يُستخدم للصفوف التي لا يحدد فيها عمود «الصندوق»">
                  <Select value={opts.cashAccountId ?? ''} onChange={(e) => setOpts((o) => ({ ...o, cashAccountId: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">اختر الصندوق</option>
                    {cashAccounts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {flags.supportsUpdate ? (
                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-sm font-medium text-slate-700">السجلات الموجودة مسبقًا</legend>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="radio" name="duplicates" className="mt-1 accent-brand-600" checked={opts.duplicates === 'skip'} onChange={() => setOpts((o) => ({ ...o, duplicates: 'skip' }))} />
                    <span className="text-[15px] text-slate-800">
                      تجاهلها <span className="text-xs text-slate-500">(الافتراضي)</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="radio" name="duplicates" className="mt-1 accent-brand-600" checked={opts.duplicates === 'update'} onChange={() => setOpts((o) => ({ ...o, duplicates: 'update' }))} />
                    <span className="flex flex-col">
                      <span className="text-[15px] text-slate-800">تحديث بياناتها من الملف</span>
                      <span className="text-xs text-slate-500">تُحدّث الحقول المعبأة فقط، ويُسجل التغيير في سجل النشاط</span>
                    </span>
                  </label>
                </fieldset>
              ) : null}
              {flags.supportsCreateMissing ? (
                <Checkbox
                  label="إنشاء الصفوف والشعب غير الموجودة"
                  description="بدلًا من اعتبارها أخطاء"
                  checked={opts.createMissing}
                  onChange={(e) => setOpts((o) => ({ ...o, createMissing: e.target.checked }))}
                />
              ) : null}
              {!flags.needsYear && !flags.needsCashAccount && !flags.supportsUpdate && !flags.supportsCreateMissing ? (
                <p className="text-sm text-slate-500">لا توجد خيارات إضافية لهذا النوع.</p>
              ) : null}
            </CardBody>
          </Card>
          {unmapped.length ? (
            <Card>
              <CardBody className="text-sm">
                <p className="mb-2 font-medium text-slate-700">أعمدة في الملف لن تُستورد ({unmapped.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {unmapped.map((x) => (
                    <Badge key={x.i} tone="gray">
                      {columnLetter(x.i)}: {x.h || '(بدون عنوان)'}
                    </Badge>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="sticky top-2 z-10 mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">
            نتيجة التحقق لـ <bdi className="num">{summary.total}</bdi> صف:
          </span>
          <Badge tone="green" dot>
            صالح <bdi className="num">{summary.valid}</bdi>
          </Badge>
          <Badge tone="amber" dot>
            مكرر <bdi className="num">{summary.duplicate}</bdi>
          </Badge>
          <Badge tone="red" dot>
            خطأ <bdi className="num">{summary.error}</bdi>
          </Badge>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {dirty ? (
            <Button
              variant="soft"
              loading={save.pending}
              onClick={() => save.run({ id: batchId, mapping: map, options: opts })}
            >
              {!save.pending ? <RefreshCw /> : null}
              تطبيق التغييرات وإعادة التحقق
            </Button>
          ) : null}
          {summary.error + summary.duplicate > 0 ? (
            <Button variant="secondary" asChild>
              <a href={`/api/import/${batchId}/errors`}>
                <Download />
                تقرير الأخطاء
              </a>
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setDiscardOpen(true)}>
            <Trash2 />
            إلغاء
          </Button>
          <Button
            variant="success"
            disabled={dirty || toImport === 0 || missingRequired.length > 0}
            title={dirty ? 'طبّق التغييرات أولًا' : undefined}
            onClick={() => setConfirmOpen(true)}
          >
            <CheckCircle2 />
            تأكيد الاستيراد (<bdi className="num">{toImport}</bdi>)
          </Button>
        </div>
        {dirty ? <p className="w-full text-xs text-amber-700">لديك تغييرات في الربط أو الخيارات لم تُطبق بعد — النتيجة أدناه للربط السابق.</p> : null}
        {!dirty && missingRequired.length ? (
          <p className="w-full text-xs text-rose-700">اربط الحقول الإجبارية أولًا: {missingRequired.map((f) => f.label).join('، ')}</p>
        ) : null}
      </div>

      {children}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`تأكيد استيراد ${typeLabel}`}
        confirmLabel="استيراد الآن"
        pending={commit.pending}
        onConfirm={() => commit.run(batchId)}
        description="يتم الاستيراد في عملية واحدة: إما أن يُحفظ كل شيء أو لا شيء."
      >
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li className="flex items-center gap-2">
            <Upload className="size-4 text-emerald-600" />
            سيُضاف <bdi className="num font-semibold">{summary.toCreate}</bdi> سجل جديد
          </li>
          {summary.toUpdate ? (
            <li className="flex items-center gap-2">
              <RefreshCw className="size-4 text-sky-600" />
              سيُحدّث <bdi className="num font-semibold">{summary.toUpdate}</bdi> سجل موجود
            </li>
          ) : null}
          {summary.total - toImport > 0 ? (
            <li className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              لن يُستورد <bdi className="num font-semibold">{summary.total - toImport}</bdi> صف (أخطاء أو مكرر)
            </li>
          ) : null}
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="إلغاء جلسة الاستيراد؟"
        description="لم يُستورد شيء من هذا الملف بعد. يمكنك رفعه من جديد لاحقًا."
        confirmLabel="إلغاء الجلسة"
        danger
        pending={discard.pending}
        onConfirm={() => discard.run(batchId)}
      />
    </>
  )
}
