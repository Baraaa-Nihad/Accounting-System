import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { chargeTypesList } from '@/server/services/charges'
import { listGradesWithSections } from '@/server/services/school'
import { listYears } from '@/server/years'
import { getSelectedYear } from '@/server/context-year'
import { PageHeader } from '@/components/ui/page-header'
import { BulkChargeForm } from '@/components/charges/bulk-charge-form'

export const metadata = { title: 'إصدار ذمم جماعية' }

export default async function BulkChargesPage() {
  await requirePermission('charges.create')
  const [years, types, grades, year] = await Promise.all([listYears(), chargeTypesList(), listGradesWithSections(db, { activeOnly: true }), getSelectedYear()])
  return (
    <>
      <PageHeader
        title="إصدار ذمم جماعية"
        description="أصدر نفس الذمة لكل طلاب صف أو عدة صفوف دفعة واحدة (مثل رسوم بداية السنة). الطالب الذي لديه نفس الذمة في السنة يُستثنى تلقائيًا."
        breadcrumbs={[{ label: 'الذمم والأقساط', href: '/charges' }, { label: 'إصدار جماعي' }]}
      />
      <BulkChargeForm
        years={years.map((y) => ({ id: y.id, name: y.name, status: y.status }))}
        chargeTypes={types.map((t) => ({ id: t.id, name: t.name }))}
        grades={grades.map((g) => ({ id: g.id, name: g.name }))}
        defaultYearId={year?.id ?? null}
      />
    </>
  )
}
