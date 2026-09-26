import * as React from 'react'
import { cn } from '@/lib/utils'
import type { Tone } from '@/lib/labels'

const tones: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  teal: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
}

export function Badge({
  tone = 'gray',
  className,
  children,
  dot,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const item = map[value] ?? { label: value, tone: 'gray' as Tone }
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  )
}
