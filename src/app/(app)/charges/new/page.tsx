import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { chargeTypesList, discountTypesList } from '@/server/services/charges'
import { listYears } from '@/server/years'
import { getSelectedYear } from '@/server/context-year'
import { PageHeader } from '@/components/ui/page-header'
import { NewChargePageForm } from '@/components/charges/new-charge-page-form'
import { intParam } from '@/lib/utils'

export const metadata = { title: 'إضافة ذمة' }

export default async function NewChargePage({ searchParams }: PageProps<'/charges/new'>) {
  const user = await requirePermission('charges.create')
  const sp = await searchParams
  const sid = intParam(sp.studentId)
  const [types, dtypes, years, year, student] = await Promise.all([
    chargeTypesList(),
    discountTypesList(),
    listYears(),
    getSelectedYear(),
    sid ? db.student.findUnique({ where: { id: sid } }) : null,
  ])
  return (
    <>
      <PageHeader title="إضافة ذمة" description="ذمة لطالب مع خصم وتقسيط اختياريين." breadcrumbs={[{ label: 'الذمم والأقساط', href: '/charges' }, { label: 'إضافة ذمة' }]} />
      <NewChargePageForm
        student={student ? { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber } : null}
        chargeTypes={types.map((t) => ({ id: t.id, name: t.name, defaultAmount: t.defaultAmount?.toString() ?? null, allowInstallments: t.allowInstallments }))}
        discountTypes={dtypes.map((t) => ({ id: t.id, name: t.name, defaultMethod: t.defaultMethod, defaultValue: t.defaultValue?.toString() ?? null }))}
        years={years.map((y) => ({ id: y.id, name: y.name, status: y.status }))}
        defaultYearId={year?.id ?? null}
        canDiscount={can(user, 'discounts.create')}
      />
    </>
  )
}
