import Link from 'next/link'
import type { Formatters } from '@/lib/format-jsx'
import type { Breakdown, CellValue, ReportColumn, ReportResult, Row, SummaryItem } from '@/server/reports/types'
import { cn } from '@/lib/utils'

const MAX_VIEW_ROWS = 1000

export function formatCell(value: CellValue | undefined, col: Pick<ReportColumn, 'type'>, f: Formatters): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-slate-300">—</span>
  switch (col.type) {
    case 'money':
      return f.money(value, { colored: true })
    case 'date':
      return f.date(String(value))
    case 'number':
      return f.number(value)
    case 'percent':
      return <bdi className="ltr num">{Number(value).toFixed(1)}%</bdi>
    default:
      return String(value)
  }
}

function SummaryTiles({ items, f }: { items: SummaryItem[]; f: Formatters }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((s, i) => (
        <div key={i} className="card px-4 py-3">
          <p className="text-xs text-slate-500">{s.label}</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {s.value === null ? '—' : s.type === 'money' ? f.money(s.value) : s.type === 'percent' ? `${Number(s.value).toFixed(1)}%` : s.type === 'number' ? f.number(s.value) : String(s.value)}
          </p>
          {s.hint ? <p className="text-xs text-slate-400">{s.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}

export function DataTable({ columns, rows, totals, f, limit }: { columns: ReportColumn[]; rows: Row[]; totals?: Row; f: Formatters; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-3 py-2.5 font-medium', c.type && c.type !== 'text' && c.type !== 'date' ? 'text-end' : 'text-start')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-12 text-center text-slate-500">
                لا توجد بيانات مطابقة للفلاتر
              </td>
            </tr>
          ) : (
            shown.map((r, i) => {
              const style = r._style as string | undefined
              return (
                <tr
                  key={i}
                  className={cn(
                    'border-t border-slate-100',
                    style === 'section' && 'bg-slate-50 font-bold text-slate-800',
                    style === 'subtotal' && 'bg-slate-50/60 font-semibold',
                    style === 'total' && 'border-t-2 border-slate-300 bg-brand-50 text-base font-bold',
                  )}
                >
                  {columns.map((c) => {
                    const href = c.href?.(r)
                    const content = formatCell(r[c.key], c, f)
                    return (
                      <td key={c.key} className={cn('px-3 py-2', c.type && c.type !== 'text' && c.type !== 'date' ? 'text-end' : 'text-start', c.type === 'date' && 'whitespace-nowrap')}>
                        {href ? (
                          <Link href={href} className="text-brand-700 hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2.5', c.type && c.type !== 'text' && c.type !== 'date' ? 'text-end' : 'text-start')}>
                  {totals[c.key] === undefined ? null : formatCell(totals[c.key], c, f)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

function BreakdownCard({ b, f }: { b: Breakdown; f: Formatters }) {
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">{b.title}</p>
      <DataTable columns={b.columns} rows={b.rows} totals={b.totals} f={f} />
    </div>
  )
}

/** عرض نتيجة تقرير: الملخص، التفصيلات الفرعية، والجدول الرئيسي. */
export function ReportView({ result, f }: { result: ReportResult; f: Formatters }) {
  const truncated = result.rows.length > MAX_VIEW_ROWS
  return (
    <div className="space-y-5">
      {result.summary?.length ? <SummaryTiles items={result.summary} f={f} /> : null}
      {result.breakdowns?.length ? (
        <div className={cn('grid gap-5', result.breakdowns.length > 1 ? 'lg:grid-cols-2' : 'lg:grid-cols-2')}>
          {result.breakdowns.map((b) => (
            <BreakdownCard key={b.title} b={b} f={f} />
          ))}
        </div>
      ) : null}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-sm">
          <span className="text-slate-500">عدد الصفوف: {f.number(result.rows.filter((r) => !r._style || r._style === 'item').length)}</span>
          {truncated ? <span className="text-amber-700">يُعرض أول {f.number(MAX_VIEW_ROWS)} صف — صدّر إلى Excel لرؤية الكل</span> : null}
        </div>
        <DataTable columns={result.columns} rows={result.rows} totals={result.totals} f={f} limit={MAX_VIEW_ROWS} />
      </div>
      {result.note ? <p className="text-xs text-slate-500">{result.note}</p> : null}
    </div>
  )
}

