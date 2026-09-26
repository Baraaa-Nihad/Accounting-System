'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fieldLabel } from '@/lib/field-labels'

/** جدول مقارنة القيم قبل/بعد (يُطوى افتراضيًا). */
export function AuditChanges({ changes, defaultOpen }: { changes: { field: string; before: string; after: string }[]; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(!!defaultOpen)
  const show = (v: string) => {
    if (v === 'null' || v === '""') return '—'
    try {
      const x = JSON.parse(v)
      if (typeof x === 'string') return x
      return JSON.stringify(x, null, 0)
    } catch {
      return v
    }
  }
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-brand-700">
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {changes.length} تغييرات
      </button>
      {open ? (
        <table className="mt-2 w-full overflow-hidden rounded-lg text-xs">
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
                <td className="max-w-60 break-words px-2 py-1 text-rose-700 line-through decoration-rose-300">{show(c.before)}</td>
                <td className="max-w-60 break-words px-2 py-1 text-emerald-700">{show(c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
