import Link from 'next/link'
import { AlertTriangle, AlertOctagon, Info, ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { getAlerts } from '@/server/services/alerts'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

export const metadata = { title: 'التنبيهات' }

const ICON = { info: Info, warning: AlertTriangle, danger: AlertOctagon }
const COLOR = { info: 'bg-sky-50 text-sky-600', warning: 'bg-amber-50 text-amber-600', danger: 'bg-rose-50 text-rose-600' }

export default async function NotificationsPage() {
  const user = await requirePermission('dashboard.view')
  const alerts = await getAlerts(user)
  return (
    <>
      <PageHeader title="مركز التنبيهات" description="كل ما يحتاج متابعة اليوم، محسوب لحظيًا من بيانات النظام." />
      <div className="card divide-y divide-slate-100">
        {alerts.length === 0 ? (
          <EmptyState title="لا توجد تنبيهات حاليًا" description="كل شيء على ما يرام." />
        ) : (
          alerts.map((a) => {
            const Icon = ICON[a.level]
            return (
              <Link key={a.id} href={a.href} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', COLOR[a.level])}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{a.title}</span>
                  {a.description ? <span className="block text-sm text-slate-500">{a.description}</span> : null}
                </span>
                <ChevronLeft className="size-5 text-slate-300" />
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}
