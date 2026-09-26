import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/server/auth/guard'
import { getSelectedYear } from '@/server/context-year'
import { getSettings, today as todayOf } from '@/server/settings'
import { getReport, canOpenReport } from '@/server/reports/registry'
import { describeFilters, parseReportFilters } from '@/server/reports/filters'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { cn } from '@/lib/utils'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { DocHeader } from '@/components/print/doc-header'
import { formatCell } from '@/components/reports/report-view'
import type { ReportColumn, Row } from '@/server/reports/types'

export const metadata = { title: 'طباعة تقرير' }

export default async function PrintReportPage({ params, searchParams }: PageProps<'/print/reports/[id]'>) {
  const user = await requireUser()
  const { id } = await params
  const def = getReport(id)
  if (!def) notFound()
  if (!canOpenReport(user, def)) redirect('/forbidden')
  const sp = await searchParams
  const [settings, today, selected] = await Promise.all([getSettings(), todayOf(), getSelectedYear()])
  const filters = await parseReportFilters(def, sp, { today, weekStartDay: settings.finance.weekStartDay, selected })
  const result = await def.run(filters, { today, settings, user })
  const meta = await describeFilters(def, filters)
  const f = makeFormatters({ ...settings.finance })
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])) as [string, string][]).toString()
  const cell = 'border border-slate-300 px-1.5 py-1'
  const align = (c: ReportColumn) => (c.type && c.type !== 'text' && c.type !== 'date' ? 'text-end' : 'text-start')
  const table = (columns: ReportColumn[], rows: Row[], totals?: Row) => (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-slate-100">
          {columns.map((c) => (
            <th key={c.key} className={cn(cell, align(c), 'font-semibold')}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={cn(r._style === 'section' && 'bg-slate-50 font-bold', (r._style === 'subtotal' || r._style === 'total') && 'font-bold')}>
            {columns.map((c) => (
              <td key={c.key} className={cn(cell, align(c), c.type === 'date' && 'whitespace-nowrap')}>
                {formatCell(r[c.key], c, f)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals ? (
        <tfoot>
          <tr className="bg-slate-100 font-bold">
            {columns.map((c) => (
              <td key={c.key} className={cn(cell, align(c))}>
                {totals[c.key] === undefined ? null : formatCell(totals[c.key], c, f)}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  )
  return (
    <>
      <PrintToolbar title={def.title} pdfHref={pdfAvailable() ? `/api/pdf/reports/${def.id}${qs ? `?${qs}` : ''}` : null} />
      <style>{`@page { size: ${def.landscape ? 'A4 landscape' : 'A4'}; margin: 8mm; }`}</style>
      <div className={cn('mx-auto my-6 bg-white p-6 shadow-lg print:my-0 print:p-0 print:shadow-none', def.landscape ? 'max-w-[297mm]' : 'max-w-[210mm]')}>
        <DocHeader school={settings.school} print={settings.print} title={def.title} meta={<p className="mt-1 text-xs text-slate-600">{f.dateText(today)}</p>} />
        {meta.length ? <p className="mt-3 text-xs text-slate-600">{meta.join(' · ')}</p> : null}
        {result.summary?.length ? (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm print:bg-transparent print:px-0">
            {result.summary.map((s, i) => (
              <span key={i}>
                <span className="text-slate-600">{s.label}: </span>
                <b>{s.value === null ? '—' : s.type === 'money' ? f.money(s.value) : s.type === 'percent' ? `${Number(s.value).toFixed(1)}%` : s.type === 'number' ? f.number(s.value) : String(s.value)}</b>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3">{table(result.columns.filter((c) => !c.viewOnly), result.rows, result.totals)}</div>
        {result.breakdowns?.map((b) => (
          <div key={b.title} className="mt-4 break-inside-avoid">
            <p className="mb-1 text-sm font-semibold">{b.title}</p>
            <div className="max-w-xl">{table(b.columns, b.rows, b.totals)}</div>
          </div>
        ))}
        {result.note ? <p className="mt-3 text-xs text-slate-500">{result.note}</p> : null}
        <div className="mt-6 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500">
          <span>
            استخرجه: {user.fullName} — {f.dateTimeText(new Date())}
          </span>
          <span>{settings.print.footerNote}</span>
        </div>
      </div>
    </>
  )
}
