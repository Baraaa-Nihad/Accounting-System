import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { withParams } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function Pagination({
  path,
  params,
  page,
  pages,
  total,
  pageSize,
}: {
  path: string
  params: Record<string, string | string[] | undefined>
  page: number
  pages: number
  total: number
  pageSize: number
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const link = (p: number) => withParams(path, params, { page: p === 1 ? null : p })
  const btn = 'flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>
        عرض <bdi className="ltr num">{from}</bdi>–<bdi className="ltr num">{to}</bdi> من <bdi className="ltr num">{total}</bdi>
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-1.5">
          {page > 1 ? (
            <Link href={link(page - 1)} className={btn} aria-label="السابق">
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className={cn(btn, 'opacity-40')}>
              <ChevronRight className="size-4" />
            </span>
          )}
          <span className="px-2">
            صفحة <bdi className="ltr num">{page}</bdi> من <bdi className="ltr num">{pages}</bdi>
          </span>
          {page < pages ? (
            <Link href={link(page + 1)} className={btn} aria-label="التالي">
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span className={cn(btn, 'opacity-40')}>
              <ChevronLeft className="size-4" />
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
