import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { otherRevenueCategories } from '@/server/ledger/accounts'
import { PageHeader } from '@/components/ui/page-header'
import { NewReceiptPanel } from '@/components/receipts/new-receipt-panel'
import { firstParam, intParam } from '@/lib/utils'

export const metadata = { title: 'سند قبض جديد' }

export default async function NewReceiptPage({ searchParams }: PageProps<'/receipts/new'>) {
  await requirePermission('receipts.create')
  const sp = await searchParams
  const studentId = intParam(sp.studentId)
  const [revenue, partners, cashAccounts, student] = await Promise.all([
    otherRevenueCategories(db),
    db.partner.findMany({ where: { isActive: true, capitalAccountId: { not: null } }, orderBy: { name: 'asc' } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    studentId ? db.student.findUnique({ where: { id: studentId } }) : null,
  ])
  const mode = (['student', 'family', 'revenue', 'partner'] as const).find((m) => m === firstParam(sp.mode)) ?? 'student'
  return (
    <>
      <PageHeader
        title="سند قبض جديد"
        description="اختر نوع القبض. كل سند يأخذ رقمًا تلقائيًا ويُحدّث الصندوق وكشوف الحساب مباشرة."
        breadcrumbs={[{ label: 'سندات القبض', href: '/receipts' }, { label: 'سند جديد' }]}
      />
      <NewReceiptPanel
        initialMode={mode}
        initialPartnerId={intParam(sp.partnerId) ?? null}
        initialStudent={student ? { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber } : null}
        revenueAccounts={revenue.map((a) => ({ id: a.id, name: a.name, code: a.code }))}
        partners={partners.map((p) => ({ id: p.id, name: p.name }))}
        cashAccounts={cashAccounts.map((c) => ({ id: c.id, name: c.name, type: c.type, isDefault: c.isDefault }))}
      />
    </>
  )
}
