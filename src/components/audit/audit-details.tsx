'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fieldLabel } from '@/lib/field-labels'

const show = (v: string) => {
  if (v === 'null' || v === '""' || v === undefined) return '—'
  try {
    const x = JSON.parse(v)
    if (x === null) return '—'
    if (typeof x === 'string') return x
    if (typeof x === 'boolean') return x ? 'نعم' : 'لا'
    return JSON.stringify(x)
  } catch {
    return v
  }
}

/** تفاصيل سطر السجل: جدول مقارنة قبل/بعد، أو بيانات السجل عند الإنشاء/الحذف، مع IP والجهاز. */
export function AuditDetails({
  changes,
  data,
  dataLabel,
  meta,
}: {
  changes: { field: string; before: string; after: string }[]
  data: { field: string; value: string }[]
  dataLabel: string
  meta: { label: string; value: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  if (!changes.length && !data.length && !meta.length) return null
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-brand-700" aria-expanded={open}>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {changes.length ? `${changes.length} حقول تغيرت` : 'التفاصيل'}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {changes.length ? (
            <table className="w-full overflow-hidden rounded-lg text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-start">الحقل</th>
                  <th className="px-2 py-1 text-start">قبل</th>
                  <th className="px-2 py-1 text-start">بعد</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1 font-medium text-slate-600">{fieldLabel(c.field)}</td>
                    <td className="max-w-72 break-words px-2 py-1 text-rose-700 line-through decoration-rose-300">{show(c.before)}</td>
                    <td className="max-w-72 break-words px-2 py-1 text-emerald-700">{show(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {data.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">{dataLabel}</p>
              <dl className="grid gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-2 text-xs sm:grid-cols-2">
                {data.map((d) => (
                  <div key={d.field} className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-slate-500">{fieldLabel(d.field)}:</dt>
                    <dd className="min-w-0 break-words text-slate-800">{show(d.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {meta.length ? (
            <p className="text-xs text-slate-500">
              {meta.map((m, i) => (
                <span key={m.label}>
                  {i > 0 ? ' · ' : ''}
                  {m.label}: <bdi className="ltr">{m.value}</bdi>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
