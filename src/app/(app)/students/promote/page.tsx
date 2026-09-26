import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { promotionCandidates } from '@/server/services/promotion'
import { getCurrentYear } from '@/server/years'
import { intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PromotionForm } from '@/components/students/promotion-form'

export const metadata = { title: 'ترحيل الطلاب' }

export default async function PromotePage({ searchParams }: PageProps<'/students/promote'>) {
  const user = await requirePermission('students.promote')
  const sp = await searchParams
  const years = await db.academicYear.findMany({ orderBy: { startDate: 'asc' }, select: { id: true, name: true, status: true, startDate: true } })
  const current = await getCurrentYear(db)
  const fromId = intParam(sp.from) ?? current?.id ?? years[0]?.id
  const from = years.find((y) => y.id === fromId)
  const next = from ? years.find((y) => y.startDate > from.startDate) : undefined
  const toId = intParam(sp.to) ?? next?.id
  const header = (
    <PageHeader
      title="ترحيل الطلاب للسنة الجديدة"
      description="يُنشأ لكل طالب تسجيل جديد في السنة الهدف حسب ربط الصفوف، والخريجون تتغير حالتهم إلى «متخرج». لا يُحذف أو يُعدّل أي سجل مالي من السنة القديمة."
      breadcrumbs={[{ label: 'الطلاب', href: '/students' }, { label: 'ترحيل الطلاب' }]}
    />
  )
  if (!from || !toId || toId === from.id) {
    return (
      <>
        {header}
        <div className="card">
          <EmptyState
            title="لا توجد سنة دراسية بعد السنة المصدر"
            description="أنشئ السنة الدراسية الجديدة أولًا من الإعدادات، ثم عُد لترحيل الطلاب."
            action={
              can(user, 'years.manage') ? (
                <Link href="/settings/years" className="inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-white hover:bg-brand-700">
                  السنوات الدراسية
                </Link>
              ) : null
            }
          />
        </div>
      </>
    )
  }
  const data = await promotionCandidates(db, from.id, toId)
  return (
    <>
      {header}
      {data.students.length === 0 ? (
        <div className="card">
          <EmptyState title={`لا يوجد طلاب مسجلون في ${from.name}`} />
        </div>
      ) : (
        <PromotionForm
          key={`${from.id}-${toId}`}
          years={years.map((y) => ({ id: y.id, name: y.name, status: y.status }))}
          fromYearId={from.id}
          toYearId={toId}
          grades={data.grades}
          students={data.students}
          canApplyFees={can(user, 'charges.create')}
        />
      )}
    </>
  )
}
