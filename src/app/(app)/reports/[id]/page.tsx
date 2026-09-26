import { notFound, redirect } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { getReport, canOpenReport } from '@/server/reports/registry'
import { ReportScreen } from '@/components/reports/report-screen'

export const metadata = { title: 'تقرير' }

export default async function ReportPage({ params, searchParams }: PageProps<'/reports/[id]'>) {
  const user = await requirePermission('reports.view')
  const { id } = await params
  const def = getReport(id)
  if (!def) notFound()
  if (!canOpenReport(user, def)) redirect('/forbidden')
  const sp = await searchParams
  return <ReportScreen def={def} sp={sp} user={user} breadcrumbs={[{ label: 'التقارير', href: '/reports' }, { label: def.title }]} />
}
