import { notFound, redirect } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { canOpenReport, getReport } from '@/server/reports/registry'
import { ReportScreen } from '@/components/reports/report-screen'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'

export const metadata = { title: 'المحاسبة العامة' }

export default async function Page({ searchParams }: PageProps<'/accounting/income-statement'>) {
  const user = await requirePermission('accounting.view')
  const def = getReport('profit-loss')
  if (!def) notFound()
  if (!canOpenReport(user, def)) redirect('/forbidden')
  const sp = await searchParams
  return <ReportScreen def={def} sp={sp} user={user} breadcrumbs={[{ label: 'المحاسبة العامة', href: '/accounting' }, { label: def.title }]} tabs={<AccountingTabs active="income" />} />
}
