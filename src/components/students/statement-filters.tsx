'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Select, Checkbox } from '@/components/ui/input'

export function StatementFilters({ years }: { years: { id: number; name: string; startDate: string; endDate: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, start] = React.useTransition()
  const update = (u: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(u)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }))
  }
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const yearMatch = years.find((y) => y.startDate === from && y.endDate === to)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        السنة الدراسية
        <Select
          value={yearMatch ? String(yearMatch.id) : ''}
          onChange={(e) => {
            const y = years.find((x) => String(x.id) === e.target.value)
            update({ from: y?.startDate ?? null, to: y?.endDate ?? null })
          }}
          className="w-40"
        >
          <option value="">كل الفترات</option>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        من تاريخ
        <Input type="date" value={from} onChange={(e) => update({ from: e.target.value || null })} className="w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        إلى تاريخ
        <Input type="date" value={to} onChange={(e) => update({ to: e.target.value || null })} className="w-40" />
      </label>
      <Checkbox className="mb-2" checked={params.get('hide') === '1'} onChange={(e) => update({ hide: e.target.checked ? '1' : null })} label="إخفاء الحركات الملغاة" />
    </div>
  )
}
