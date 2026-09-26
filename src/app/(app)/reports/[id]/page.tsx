import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { FileSpreadsheet, Printer, FileDown } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { getSelectedYear } from '@/server/context-year'
import { getFormatConfig, getSettings, today as todayOf } from '@/server/settings'
import { getReport, canOpenReport } from '@/server/reports/registry'
import { parseReportFilters } from '@/server/reports/filters'
import { buildFilterControls } from '@/server/reports/controls'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { ReportFilterBar } from '@/components/reports/report-filter-bar'
import { ReportView } from '@/components/reports/report-view'

export const metadata = { title: 'تقرير' }

export default async function ReportPage({ params, searchParams }: PageProps<'/reports/[id]'>) {
  const user = await requirePermission('reports.view')
  const { id } = await params
  const def = getReport(id)
  if (!def) notFound()
  if (!canOpenReport(user, def)) redirect('/forbidden')
  const sp = await searchParams
  const [settings, fmt, today, selected] = await Promise.all([getSettings(), getFormatConfig(), todayOf(), getSelectedYear()])
  const filters = await parseReportFilters(def, sp, { today, weekStartDay: settings.finance.weekStartDay, selected })
  const [result, ui] = await Promise.all([def.run(filters, { today, settings, user }), buildFilterControls(def, filters)])
  const f = makeFormatters(fmt)
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])) as [string, string][]).toString()
  const suffix = qs ? `?${qs}` : ''
  const canExport = can(user, 'reports.export')
  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        breadcrumbs={[{ label: 'التقارير', href: '/reports' }, { label: def.title }]}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/print/reports/${def.id}${suffix}`} target="_blank">
                <Printer />
                طباعة
              </Link>
            </Button>
            {canExport && pdfAvailable() ? (
              <Button variant="secondary" asChild>
                <a href={`/api/pdf/reports/${def.id}${suffix}`}>
                  <FileDown />
                  PDF
                </a>
              </Button>
            ) : null}
            {canExport ? (
              <>
                <Button variant="secondary" asChild>
                  <a href={`/api/reports/${def.id}/export?format=xlsx${qs ? `&${qs}` : ''}`}>
                    <FileSpreadsheet />
                    Excel
                  </a>
                </Button>
                <Button variant="ghost" asChild>
                  <a href={`/api/reports/${def.id}/export?format=csv${qs ? `&${qs}` : ''}`}>CSV</a>
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="card mb-5 overflow-visible">
        <ReportFilterBar controls={ui.controls} period={ui.period} student={ui.student} current={ui.current} />
      </div>
      <ReportView result={result} f={f} />
    </>
  )
}
