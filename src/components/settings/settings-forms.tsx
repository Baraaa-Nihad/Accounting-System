'use client'

import * as React from 'react'
import { Save, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Field, FormSection } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { saveSettingsAction, uploadLogoAction } from '@/app/(app)/settings/actions'
import type { Settings } from '@/server/settings'
import { CURRENCIES } from '@/lib/tafqeet'

function SaveBar({ pending }: { pending: boolean }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" size="lg" loading={pending}>
        {!pending ? <Save /> : null}
        حفظ الإعدادات
      </Button>
    </div>
  )
}

export function SchoolSettingsForm({ value }: { value: Settings['school'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending, fieldErrors } = useAction((x: unknown) => saveSettingsAction('school', x))
  const logo = useAction(uploadLogoAction)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }))
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="بيانات المدرسة" description="تظهر في ترويسة السندات والتقارير المطبوعة.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المدرسة" required error={fieldErrors.name}>
            <Input value={v.name} onChange={set('name')} />
          </Field>
          <Field label="الاسم بالإنجليزية">
            <Input value={v.nameEn} onChange={set('nameEn')} dir="ltr" className="text-start" />
          </Field>
          <Field label="العنوان" className="sm:col-span-2">
            <Input value={v.address} onChange={set('address')} />
          </Field>
          <Field label="الهاتف">
            <Input value={v.phone} onChange={set('phone')} dir="ltr" className="text-start" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input value={v.email} onChange={set('email')} dir="ltr" className="text-start" />
          </Field>
          <Field label="الموقع الإلكتروني">
            <Input value={v.website} onChange={set('website')} dir="ltr" className="text-start" />
          </Field>
          <Field label="الرقم الضريبي / رقم الترخيص">
            <Input value={v.taxNumber} onChange={set('taxNumber')} dir="ltr" className="text-start" />
          </Field>
        </div>
      </FormSection>
      <FormSection title="الشعار" description="صورة PNG أو JPG بخلفية بيضاء أو شفافة (حتى 2 ميغابايت).">
        <div className="flex items-center gap-4">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {value.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/logo?v=${value.logo}`} alt="الشعار" className="size-20 object-contain" />
            ) : (
              <span className="text-xs text-slate-400">لا يوجد</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const fd = new FormData()
              fd.set('file', file)
              logo.run(fd)
            }}
          />
          <Button type="button" variant="secondary" loading={logo.pending} onClick={() => fileRef.current?.click()}>
            {!logo.pending ? <Upload /> : null}
            رفع شعار
          </Button>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

const TIMEZONES = ['Asia/Hebron', 'Asia/Gaza', 'Asia/Jerusalem', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Asia/Damascus', 'Asia/Beirut', 'Africa/Cairo', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Algiers', 'Africa/Casablanca', 'Africa/Khartoum', 'Asia/Aden']

export function FinanceSettingsForm({ value }: { value: Settings['finance'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('finance', x))
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="العملة" description="تغيير العملة لا يغير المبالغ المسجلة، بل طريقة عرضها وكتابتها بالحروف.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="العملة">
            <Select
              value={v.currencyCode}
              onChange={(e) => {
                const c = CURRENCIES.find((x) => x.code === e.target.value)
                setV((p) => ({ ...p, currencyCode: e.target.value, currencySymbol: c?.symbol ?? p.currencySymbol, decimals: c?.decimals ?? p.decimals }))
              }}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="رمز العملة">
            <Input value={v.currencySymbol} onChange={(e) => setV((p) => ({ ...p, currencySymbol: e.target.value }))} />
          </Field>
          <Field label="عدد المنازل العشرية">
            <Select value={String(v.decimals)} onChange={(e) => setV((p) => ({ ...p, decimals: Number(e.target.value) }))}>
              {[0, 1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FormSection>
      <FormSection title="التاريخ والوقت">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="المنطقة الزمنية" hint="تحدد «اليوم» في النظام">
            <Select value={v.timezone} onChange={(e) => setV((p) => ({ ...p, timezone: e.target.value }))}>
              {TIMEZONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تنسيق التاريخ">
            <Select value={v.dateFormat} onChange={(e) => setV((p) => ({ ...p, dateFormat: e.target.value as typeof p.dateFormat }))}>
              <option value="dd/MM/yyyy">26/09/2026</option>
              <option value="dd-MM-yyyy">26-09-2026</option>
              <option value="yyyy-MM-dd">2026-09-26</option>
            </Select>
          </Field>
          <Field label="بداية الأسبوع">
            <Select value={String(v.weekStartDay)} onChange={(e) => setV((p) => ({ ...p, weekStartDay: Number(e.target.value) }))}>
              <option value="6">السبت</option>
              <option value="0">الأحد</option>
              <option value="1">الاثنين</option>
            </Select>
          </Field>
        </div>
      </FormSection>
      <FormSection title="قواعد مالية">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="أيام السماح قبل اعتبار القسط متأخرًا" hint="0 = يُعتبر متأخرًا من اليوم التالي للاستحقاق">
            <Input type="number" min={0} max={90} value={v.graceDays} onChange={(e) => setV((p) => ({ ...p, graceDays: Number(e.target.value) || 0 }))} dir="ltr" className="text-left" />
          </Field>
          <Field label="حد تنبيه انخفاض رصيد الصندوق" hint="يُستخدم للصناديق التي ليس لها حد خاص">
            <Input type="number" min={0} value={v.lowCashThreshold} onChange={(e) => setV((p) => ({ ...p, lowCashThreshold: Number(e.target.value) || 0 }))} dir="ltr" className="text-left" />
          </Field>
          <Field label="رمز الدولة للهاتف">
            <Input value={v.countryDialCode} onChange={(e) => setV((p) => ({ ...p, countryDialCode: e.target.value.replace(/\D/g, '') }))} dir="ltr" className="text-left" />
          </Field>
          <div className="self-end">
            <Checkbox checked={v.allowNegativeCash} onChange={(e) => setV((p) => ({ ...p, allowNegativeCash: e.target.checked }))} label="السماح بالصرف أكثر من رصيد الصندوق/البنك" description="غير مستحسن؛ الافتراضي منع ذلك" />
          </div>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

export function NumberingSettingsForm({ value }: { value: Settings['numbering'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('numbering', x))
  const rows: { key: keyof typeof v; label: string; yearly: boolean }[] = [
    { key: 'receipt', label: 'سند القبض', yearly: true },
    { key: 'voucher', label: 'سند الصرف', yearly: true },
    { key: 'transfer', label: 'التحويل', yearly: true },
    { key: 'bill', label: 'فاتورة المورد', yearly: true },
    { key: 'journal', label: 'القيد اليومي', yearly: true },
    { key: 'student', label: 'رقم الطالب', yearly: false },
    { key: 'employee', label: 'الرقم الوظيفي', yearly: false },
  ]
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="ترقيم المستندات" description="الأرقام متسلسلة وفريدة ولا تتكرر. تغيير البادئة يؤثر على المستندات الجديدة فقط.">
        <div className="space-y-3">
          {rows.map((r) => {
            const fmt = v[r.key]
            const example = r.yearly
              ? `${fmt.prefix ? `${fmt.prefix}-` : ''}2026-${'1'.padStart(fmt.padding, '0')}`
              : `${fmt.prefix}${'1'.padStart(fmt.padding, '0')}`
            return (
              <div key={r.key} className="grid items-end gap-3 sm:grid-cols-4">
                <p className="pb-2.5 font-medium text-slate-700">{r.label}</p>
                <Field label="البادئة">
                  <Input value={fmt.prefix} onChange={(e) => setV((p) => ({ ...p, [r.key]: { ...fmt, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') } }))} dir="ltr" className="text-left" />
                </Field>
                <Field label="عدد الخانات">
                  <Input type="number" min={1} max={10} value={fmt.padding} onChange={(e) => setV((p) => ({ ...p, [r.key]: { ...fmt, padding: Math.min(10, Math.max(1, Number(e.target.value) || 1)) } }))} dir="ltr" className="text-left" />
                </Field>
                <p className="pb-2.5 text-sm text-slate-500">
                  مثال: <bdi className="ltr num font-medium text-slate-800">{example}</bdi>
                </p>
              </div>
            )
          })}
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

export function PrintSettingsForm({ value }: { value: Settings['print'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('print', x))
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="الطباعة">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="مقاس ورق السندات">
            <Select value={v.receiptPaper} onChange={(e) => setV((p) => ({ ...p, receiptPaper: e.target.value as 'A5' | 'A4' }))}>
              <option value="A5">A5 أفقي (نصف صفحة)</option>
              <option value="A4">A4</option>
            </Select>
          </Field>
          <div className="self-end">
            <Checkbox checked={v.showLogo} onChange={(e) => setV((p) => ({ ...p, showLogo: e.target.checked }))} label="إظهار الشعار في المطبوعات" />
          </div>
          <Field label="نص أعلى المستندات" className="sm:col-span-2">
            <Input value={v.headerNote} onChange={(e) => setV((p) => ({ ...p, headerNote: e.target.value }))} />
          </Field>
          <Field label="نص أسفل المستندات" className="sm:col-span-2">
            <Input value={v.footerNote} onChange={(e) => setV((p) => ({ ...p, footerNote: e.target.value }))} />
          </Field>
          <Field label="توقيعات سند القبض" hint="افصل بينها بفاصلة">
            <Input value={v.receiptSignatures.join('، ')} onChange={(e) => setV((p) => ({ ...p, receiptSignatures: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 4) }))} />
          </Field>
          <Field label="توقيعات سند الصرف" hint="افصل بينها بفاصلة">
            <Input value={v.voucherSignatures.join('، ')} onChange={(e) => setV((p) => ({ ...p, voucherSignatures: e.target.value.split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 4) }))} />
          </Field>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

export function PayrollSettingsForm({ value }: { value: Settings['payroll'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('payroll', x))
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: Number(e.target.value) || 0 }))
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="الرواتب" description="تُستخدم في حساب خصم الغياب والتأخير وتنبيهات موعد الرواتب.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="عدد أيام الشهر لحساب الأجر اليومي" hint="الراتب ÷ هذا الرقم = أجر اليوم">
            <Input type="number" min={1} max={31} value={v.workDaysPerMonth} onChange={num('workDaysPerMonth')} dir="ltr" className="text-left" />
          </Field>
          <Field label="ساعات العمل اليومية" hint="لحساب خصم التأخير بالساعة">
            <Input type="number" min={1} max={24} value={v.hoursPerDay} onChange={num('hoursPerDay')} dir="ltr" className="text-left" />
          </Field>
          <Field label="يوم صرف الرواتب في الشهر">
            <Input type="number" min={1} max={31} value={v.payDay} onChange={num('payDay')} dir="ltr" className="text-left" />
          </Field>
          <Field label="التنبيه قبل موعد الرواتب بـ (أيام)">
            <Input type="number" min={0} max={15} value={v.alertDaysBefore} onChange={num('alertDaysBefore')} dir="ltr" className="text-left" />
          </Field>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

export function SecuritySettingsForm({ value }: { value: Settings['security'] }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('security', x))
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: Number(e.target.value) || 0 }))
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(v) }}>
      <FormSection title="الأمان وتسجيل الدخول">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="عدد المحاولات الفاشلة قبل القفل">
            <Input type="number" min={3} max={20} value={v.maxFailedAttempts} onChange={num('maxFailedAttempts')} dir="ltr" className="text-left" />
          </Field>
          <Field label="مدة القفل (دقيقة)">
            <Input type="number" min={1} max={1440} value={v.lockMinutes} onChange={num('lockMinutes')} dir="ltr" className="text-left" />
          </Field>
          <Field label="انتهاء الجلسة بعد عدم النشاط (ساعة)">
            <Input type="number" min={1} max={72} value={v.sessionHours} onChange={num('sessionHours')} dir="ltr" className="text-left" />
          </Field>
        </div>
      </FormSection>
      <SaveBar pending={pending} />
    </form>
  )
}

