import Link from 'next/link'
import { ChevronLeft, FileBarChart2 } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { REPORTS, canOpenReport } from '@/server/reports/registry'
import { REPORT_GROUPS, type ReportGroup } from '@/server/reports/types'
import { PageHeader } from '@/components/ui/page-header'

export const metadata = { title: 'التقارير' }

export default async function ReportsPage() {
  const user = await requirePermission('reports.view')
  const available = REPORTS.map((r, i) => ({ ...r, index: i + 1 })).filter((r) => canOpenReport(user, r))
  const groups = (Object.keys(REPORT_GROUPS) as ReportGroup[]).map((g) => ({ key: g, label: REPORT_GROUPS[g], items: available.filter((r) => r.group === g) })).filter((g) => g.items.length)
  return (
    <>
      <PageHeader title="مركز التقارير" description="كل تقرير يدعم الفلترة حسب الفترة والسنة والطالب والصف والنوع وطريقة الدفع والمستخدم والمبلغ، ويُصدّر إلى Excel وCSV وPDF أو يُطبع مباشرة." />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-3 text-sm font-semibold text-slate-500">{g.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((r) => (
                <Link key={r.id} href={`/reports/${r.id}`} className="card group flex items-start gap-3 p-4 transition-shadow hover:shadow-md">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <FileBarChart2 className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold text-slate-900">
                      <span className="num text-xs text-slate-400">{r.index}</span>
                      {r.title.replace(/^تقرير /, '')}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">{r.description}</span>
                  </span>
                  <ChevronLeft className="mt-2 size-4 text-slate-300 group-hover:text-brand-600" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
