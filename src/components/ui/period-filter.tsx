'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange } from 'lucide-react'
import { Input, Select } from './input'
import { useFormat } from '@/components/providers/app-provider'
import { PERIOD_LABELS, type PeriodKey } from '@/lib/period'

/** اختيار الفترة: قوالب جاهزة أو من/إلى. يكتب معاملات period/from/to في الرابط. */
export function PeriodFilter({ current, children }: { current: { key: PeriodKey; from: string | null; to: string | null }; children?: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const f = useFormat()
  const [pending, start] = React.useTransition()
  const update = (u: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(u)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    next.delete('page')
    const qs = next.toString()
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  return (
    <div className="no-print flex flex-wrap items-end gap-3 p-4">
      <label className="flex min-w-48 flex-col gap-1 text-xs font-medium text-slate-500">
        الفترة
        <Select
          value={current.key}
          onChange={(e) => {
            const key = e.target.value as PeriodKey
            if (key === 'custom') update({ period: null, from: current.from, to: current.to })
            else update({ period: key === 'year' ? null : key, from: null, to: null })
          }}
        >
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
            <option key={k} value={k}>
              {PERIOD_LABELS[k]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        من تاريخ
        <Input type="date" value={current.from ?? ''} onChange={(e) => update({ period: null, from: e.target.value || null, to: current.to })} className="w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        إلى تاريخ
        <Input type="date" value={current.to ?? ''} onChange={(e) => update({ period: null, from: current.from, to: e.target.value || null })} className="w-40" />
      </label>
      {children}
      <p className="flex items-center gap-1.5 self-center text-sm text-slate-500">
        <CalendarRange className="size-4" />
        {current.from || current.to ? (
          <>
            {current.from ? f.date(current.from) : '...'} ← {current.to ? f.date(current.to) : '...'}
          </>
        ) : (
          'كل الفترات'
        )}
        {pending ? <span className="text-xs text-slate-400">جارٍ التحميل…</span> : null}
      </p>
    </div>
  )
}
