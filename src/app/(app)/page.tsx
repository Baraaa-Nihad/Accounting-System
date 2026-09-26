import { requirePermission } from '@/server/auth/guard'
import { PageHeader } from '@/components/ui/page-header'

export default async function DashboardPage() {
  const user = await requirePermission('dashboard.view')
  return <PageHeader title={`أهلًا ${user.fullName}`} description="ملخص الوضع المالي للمدرسة" />
}
