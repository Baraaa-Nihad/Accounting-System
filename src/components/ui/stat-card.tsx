import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const accents = {
  brand: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-rose-50 text-rose-700',
  blue: 'bg-sky-50 text-sky-700',
  violet: 'bg-violet-50 text-violet-700',
  slate: 'bg-slate-100 text-slate-600',
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = 'brand',
  href,
  emphasis,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
  accent?: keyof typeof accents
  href?: string
  emphasis?: boolean
  className?: string
}) {
  const body = (
    <div className={cn('card flex h-full items-start gap-3.5 p-4 transition-shadow', href && 'hover:shadow-md', className)}>
      {icon ? (
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5', accents[accent])}>
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500">{label}</p>
        <p className={cn('num mt-0.5 truncate text-start font-bold text-slate-900', emphasis ? 'text-2xl' : 'text-xl')}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  )
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  )
}
