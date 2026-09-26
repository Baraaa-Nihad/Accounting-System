'use client'

import * as React from 'react'
import { Popover } from 'radix-ui'
import { Search, X, Loader2, GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inputClass } from '@/components/ui/input'
import { useFormat } from '@/components/providers/app-provider'

export interface PickedStudent {
  id: number
  fullName: string
  studentNumber: string
  gradeName?: string | null
  sectionName?: string | null
  guardianName?: string | null
  guardianPhone?: string | null
  remaining?: string
  credit?: string
}

/** اختيار طالب بالبحث (الاسم، الرقم، هاتف ولي الأمر). */
export function StudentPicker({
  value,
  onChange,
  placeholder = 'ابحث باسم الطالب أو رقمه أو هاتف ولي الأمر...',
  invalid,
  autoFocus,
}: {
  value: PickedStudent | null
  onChange: (s: PickedStudent | null) => void
  placeholder?: string
  invalid?: boolean
  autoFocus?: boolean
}) {
  const f = useFormat()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState<PickedStudent[]>([])
  const [loading, setLoading] = React.useState(false)
  const [highlight, setHighlight] = React.useState(0)

  React.useEffect(() => {
    const query = q.trim()
    if (!query) return
    const controller = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/students/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        if (res.ok) {
          setResults((await res.json()).results)
          setHighlight(0)
        }
      } catch {
        /* إلغاء */
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [q])

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-white text-brand-600">
          <GraduationCap className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{value.fullName}</p>
          <p className="truncate text-xs text-slate-500">
            رقم {value.studentNumber}
            {value.gradeName ? ` · ${value.gradeName}${value.sectionName ? ` - ${value.sectionName}` : ''}` : ''}
            {value.guardianName ? ` · ${value.guardianName}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="تغيير الطالب">
          <X className="size-4" />
        </button>
      </div>
    )
  }

  const shown = q.trim() ? results : []
  return (
    <Popover.Root open={open && q.trim().length > 0} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus={autoFocus}
            value={q}
            aria-invalid={invalid}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlight((h) => Math.min(h + 1, shown.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight((h) => Math.max(h - 1, 0))
              } else if (e.key === 'Enter' && shown[highlight]) {
                e.preventDefault()
                onChange(shown[highlight])
                setQ('')
                setOpen(false)
              }
            }}
            placeholder={placeholder}
            className={cn(inputClass, 'pr-9')}
          />
          {loading ? <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] max-h-80 w-[var(--radix-popover-trigger-width)] min-w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          dir="rtl"
        >
          {shown.length === 0 && !loading ? <p className="px-3 py-6 text-center text-sm text-slate-500">لا يوجد طالب مطابق</p> : null}
          {shown.map((s, i) => (
            <button
              type="button"
              key={s.id}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onChange(s)
                setQ('')
                setOpen(false)
              }}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start', i === highlight ? 'bg-brand-50' : 'hover:bg-slate-50')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{s.fullName}</span>
                <span className="block truncate text-xs text-slate-500">
                  رقم {s.studentNumber}
                  {s.gradeName ? ` · ${s.gradeName}` : ''}
                  {s.guardianName ? ` · ${s.guardianName}` : ''}
                  {s.guardianPhone ? ` · ${s.guardianPhone}` : ''}
                </span>
              </span>
              {s.remaining && Number(s.remaining) > 0 ? (
                <span className="shrink-0 text-xs text-rose-600">{f.money(s.remaining)}</span>
              ) : null}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
