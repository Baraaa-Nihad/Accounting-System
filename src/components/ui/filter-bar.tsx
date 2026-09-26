'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input, Select } from './input'
import { Button } from './button'

export type FilterField =
  | { type: 'search'; name: string; placeholder?: string }
  | { type: 'select'; name: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { type: 'date'; name: string; label: string }
  | { type: 'number'; name: string; label: string; placeholder?: string }

/** شريط فلاتر يحدّث معاملات الرابط؛ الصفحة تُعيد جلب بياناتها من الخادم. */
export function FilterBar({ fields, children }: { fields: FilterField[]; children?: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const searchField = fields.find((f) => f.type === 'search')
  const [q, setQ] = React.useState(searchField ? (params.get(searchField.name) ?? '') : '')

  const update = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '') next.delete(k)
        else next.set(k, v)
      }
      next.delete('page')
      const qs = next.toString()
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    },
    [params, pathname, router],
  )

  React.useEffect(() => {
    if (!searchField) return
    const current = params.get(searchField.name) ?? ''
    if (q === current) return
    const t = setTimeout(() => update({ [searchField.name]: q.trim() || null }), 350)
    return () => clearTimeout(t)
  }, [q, searchField, params, update])

  const active = fields.some((f) => f.type !== 'search' && params.get(f.name))

  return (
    <div className="no-print flex flex-wrap items-end gap-3 p-4">
      {fields.map((f) => {
        if (f.type === 'search') {
          return (
            <div key={f.name} className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={f.placeholder ?? 'بحث...'} className="pr-9" />
            </div>
          )
        }
        if (f.type === 'select') {
          return (
            <label key={f.name} className="flex min-w-40 flex-col gap-1 text-xs font-medium text-slate-500">
              {f.label}
              <Select value={params.get(f.name) ?? ''} onChange={(e) => update({ [f.name]: e.target.value || null })}>
                <option value="">{f.allLabel ?? 'الكل'}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </label>
          )
        }
        if (f.type === 'date') {
          return (
            <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {f.label}
              <Input type="date" value={params.get(f.name) ?? ''} onChange={(e) => update({ [f.name]: e.target.value || null })} className="w-40" />
            </label>
          )
        }
        return (
          <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            {f.label}
            <Input
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={params.get(f.name) ?? ''}
              placeholder={f.placeholder}
              onBlur={(e) => update({ [f.name]: e.target.value || null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') update({ [f.name]: (e.target as HTMLInputElement).value || null })
              }}
              className="w-32"
            />
          </label>
        )
      })}
      {children}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-10"
          onClick={() => {
            setQ('')
            startTransition(() => router.replace(pathname, { scroll: false }))
          }}
        >
          <X />
          مسح الفلاتر
        </Button>
      ) : null}
      {pending ? <span className="self-center text-xs text-slate-400">جارٍ التحميل…</span> : null}
    </div>
  )
}
