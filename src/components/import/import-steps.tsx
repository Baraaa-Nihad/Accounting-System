import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = ['اختيار النوع وتنزيل القالب', 'رفع الملف', 'ربط الأعمدة', 'المعاينة والتحقق', 'التأكيد والاستيراد']

/** مؤشر خطوات معالج الاستيراد (docs/12-excel-import.md §12.2). */
export function ImportSteps({ current }: { current: number }) {
  return (
    <ol className="no-print scroll-thin mb-5 flex gap-2 overflow-x-auto pb-1">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <li
            key={label}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
              done && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              active && 'border-brand-300 bg-brand-50 font-semibold text-brand-800',
              !done && !active && 'border-slate-200 bg-white text-slate-500',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-xs',
                done ? 'bg-emerald-600 text-white' : active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500',
              )}
            >
              {done ? <Check className="size-3" /> : <span className="num">{n}</span>}
            </span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}
