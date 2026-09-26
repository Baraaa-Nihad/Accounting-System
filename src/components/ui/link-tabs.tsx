import Link from 'next/link'
import { cn } from '@/lib/utils'

/** تبويبات عبر الرابط (كل تبويب يُحمّل بياناته من الخادم عند فتحه). */
export function LinkTabs({
  tabs,
  active,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number | null }[]
  active: string
  className?: string
}) {
  return (
    <div className={cn('no-print scroll-thin flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-[15px] font-medium transition-colors',
            t.key === active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count ? (
            <span className={cn('rounded-full px-1.5 text-xs', t.key === active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  )
}
