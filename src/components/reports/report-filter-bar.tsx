'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X, CalendarRange } from 'lucide-react'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StudentPicker, type PickedStudent } from '@/components/forms/student-picker'
import { useFormat } from '@/components/providers/app-provider'
import { PERIOD_LABELS, type PeriodKey } from '@/lib/period'
import { PAYMENT_METHOD } from '@/lib/labels'

export interface FilterControl {
  key: string
  label: string
  options?: { value: string; label: string }[]
  allLabel?: string
  /** للنوع والحالة: القيمة «all» صريحة لأن الغياب يعني القيمة الافتراضية */
  explicitAll?: boolean
  allowAllYears?: boolean
}

/** شريط فلاتر التقرير: كل الفلاتر في صف واحد أعلى التقرير، تُكتب في الرابط فيُعاد حساب التقرير. */
export function ReportFilterBar({
  controls,
  period,
  student,
  current,
}: {
  controls: FilterControl[]
  period: { key: PeriodKey; from: string | null; to: string | null; defaultKey: PeriodKey } | null
  student: PickedStudent | null
  current: Record<string, string>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const f = useFormat()
  const [pending, start] = React.useTransition()
  const [q, setQ] = React.useState(current.q ?? '')
  const update = React.useCallback(
    (u: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(u)) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      const qs = next.toString()
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    },
    [params, pathname, router],
  )
  const hasQ = controls.some((c) => c.key === 'q')
  React.useEffect(() => {
    if (!hasQ) return
    const cur = params.get('q') ?? ''
    if (q === cur) return
    const t = setTimeout(() => update({ q: q.trim() || null }), 400)
    return () => clearTimeout(t)
  }, [q, hasQ, params, update])

  const label = 'flex flex-col gap-1 text-xs font-medium text-slate-500'
  return (
    <div className="no-print flex flex-wrap items-end gap-3 p-4">
      {period ? (
        <>
          <label className={`${label} min-w-40`}>
            الفترة
            <Select
              value={period.key}
              onChange={(e) => {
                const key = e.target.value as PeriodKey
                if (key === 'custom') update({ period: null, from: period.from, to: period.to })
                else update({ period: key === period.defaultKey ? null : key, from: null, to: null })
              }}
            >
              {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className={label}>
            من
            <Input type="date" value={period.from ?? ''} onChange={(e) => update({ period: null, from: e.target.value || null, to: period.to })} className="w-38" />
          </label>
          <label className={label}>
            إلى
            <Input type="date" value={period.to ?? ''} onChange={(e) => update({ period: null, from: period.from, to: e.target.value || null })} className="w-38" />
          </label>
        </>
      ) : null}
      {controls.map((c) => {
        if (c.key === 'q') {
          return (
            <label key="q" className={`${label} min-w-48 flex-1`}>
              {c.label}
              <span className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث..." className="pr-9" />
              </span>
            </label>
          )
        }
        if (c.key === 'student') {
          return (
            <div key="student" className={`${label} min-w-64`}>
              {c.label}
              <StudentPicker value={student} onChange={(s) => update({ student: s ? String(s.id) : null })} placeholder="كل الطلاب — ابحث لاختيار طالب" />
            </div>
          )
        }
        if (c.key === 'amount') {
          return (
            <div key="amount" className="flex items-end gap-2">
              {(['min', 'max'] as const).map((k) => (
                <label key={k} className={label}>
                  {k === 'min' ? `${c.label} من` : 'إلى'}
                  <Input
                    defaultValue={current[k] ?? ''}
                    inputMode="decimal"
                    dir="ltr"
                    className="w-28 text-left"
                    onBlur={(e) => update({ [k]: e.target.value.trim() || null })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') update({ [k]: (e.target as HTMLInputElement).value.trim() || null })
                    }}
                  />
                </label>
              ))}
            </div>
          )
        }
        const options = c.key === 'method' ? Object.entries(PAYMENT_METHOD).map(([value, l]) => ({ value, label: l })) : (c.options ?? [])
        const allValue = c.explicitAll ? 'all' : ''
        return (
          <label key={c.key} className={`${label} min-w-36`}>
            {c.label}
            <Select value={current[c.key] ?? ''} onChange={(e) => update({ [c.key]: e.target.value || null })}>
              {c.key === 'year' ? null : <option value={allValue}>{c.allLabel ?? 'الكل'}</option>}
              {c.key === 'year' && c.allowAllYears ? <option value="all">كل السنوات</option> : null}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        className="h-10"
        onClick={() => {
          setQ('')
          start(() => router.replace(pathname, { scroll: false }))
        }}
      >
        <X />
        الافتراضي
      </Button>
      {period && (period.from || period.to) ? (
        <p className="flex items-center gap-1.5 self-center text-xs text-slate-500">
          <CalendarRange className="size-4" />
          {period.from ? f.date(period.from) : '...'} ← {period.to ? f.date(period.to) : '...'}
        </p>
      ) : null}
      {pending ? <span className="self-center text-xs text-slate-400">جارٍ التحديث…</span> : null}
    </div>
  )
}
