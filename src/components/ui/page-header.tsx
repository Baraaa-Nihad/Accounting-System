import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  breadcrumbs?: { label: string; href?: string }[]
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav className="no-print mb-2 flex flex-wrap items-center gap-1 text-sm text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {b.href ? (
                <Link href={b.href} className="hover:text-brand-700">
                  {b.label}
                </Link>
              ) : (
                <span className="text-slate-700">{b.label}</span>
              )}
              {i < breadcrumbs.length - 1 ? <ChevronLeft className="size-3.5 text-slate-400" /> : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-[15px] text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
