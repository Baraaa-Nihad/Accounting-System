import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Users, Phone } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { studentFinancialSummary } from '@/server/services/students'
import { getFormatConfig } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { FamilyPaymentDialog } from '@/components/receipts/quick-payment-dialog'
import { GuardianEditDialog } from '@/components/students/guardian-edit-dialog'
import { STUDENT_STATUS, PAYMENT_METHOD, DOC_STATUS } from '@/lib/labels'
import { D, sum } from '@/lib/money'

export const metadata = { title: 'حساب العائلة' }

export default async function FamilyPage({ params }: PageProps<'/families/[id]'>) {
  const user = await requirePermission('students.view')
  const { id } = await params
  const guardian = await db.guardian.findUnique({
    where: { id: Number(id) },
    include: { students: { orderBy: { fullName: 'asc' } } },
  })
  if (!guardian) notFound()
  const [fmt, year] = await Promise.all([getFormatConfig(), getSelectedYear()])
  const f = makeFormatters(fmt)
  const summaries = await Promise.all(guardian.students.map((s) => studentFinancialSummary(db, s.id)))
  const enrollments = await db.enrollment.findMany({
    where: { studentId: { in: guardian.students.map((s) => s.id) }, academicYearId: year?.id ?? -1 },
    include: { grade: true, section: true },
  })
  const receipts = await db.receipt.findMany({
    where: { OR: [{ guardianId: guardian.id }, { studentId: { in: guardian.students.map((s) => s.id) } }] },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 15,
  })
  const totals = {
    gross: sum(summaries.map((s) => s.gross)),
    discount: sum(summaries.map((s) => s.discount)),
    paid: sum(summaries.map((s) => s.paid)),
    balance: sum(summaries.map((s) => s.balance)),
    overdue: sum(summaries.map((s) => s.overdue)),
  }
  return (
    <>
      <PageHeader
        title={`حساب عائلة: ${guardian.name}`}
        description={
          <span className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1">
              <Users className="size-4" /> {guardian.students.length} أبناء
            </span>
            {guardian.phone ? (
              <a href={`tel:${guardian.phone}`} className="flex items-center gap-1 hover:text-brand-700">
                <Phone className="size-4" />
                <bdi className="ltr num">{guardian.phone}</bdi>
              </a>
            ) : null}
          </span>
        }
        breadcrumbs={[{ label: 'الطلاب', href: '/students' }, { label: 'العائلات', href: '/families' }, { label: guardian.name }]}
        actions={
          <>
            {can(user, 'families.manage') || can(user, 'students.edit') ? <GuardianEditDialog guardian={guardian} /> : null}
            {can(user, 'receipts.create') && guardian.students.length > 0 ? <FamilyPaymentDialog guardian={{ id: guardian.id, name: guardian.name }} /> : null}
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="إجمالي المطلوب للعائلة" value={f.money(totals.gross.minus(totals.discount))} hint={`بعد خصومات ${f.moneyText(totals.discount)}`} />
        <StatCard label="إجمالي المدفوع" value={f.money(totals.paid)} accent="green" />
        <StatCard label={totals.balance.isNegative() ? 'رصيد دائن للعائلة' : 'المتبقي على العائلة'} value={f.money(totals.balance.abs())} accent={totals.balance.greaterThan(0) ? 'amber' : 'green'} emphasis />
        <StatCard label="منه متأخر" value={f.money(totals.overdue)} accent="red" />
      </div>
      <div className="card mb-5 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">الأبناء</h3>
        </div>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الطالب</TH>
                <TH>الصف</TH>
                <TH>الحالة</TH>
                <TH numeric>المطلوب</TH>
                <TH numeric>الخصومات</TH>
                <TH numeric>المدفوع</TH>
                <TH numeric>المتبقي</TH>
                <TH numeric>المتأخر</TH>
              </tr>
            </THead>
            <tbody>
              {guardian.students.map((s, i) => {
                const sm = summaries[i]
                const e = enrollments.find((x) => x.studentId === s.id)
                return (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/students/${s.id}`} className="font-semibold hover:text-brand-700">
                        {s.fullName}
                      </Link>
                      <span className="block text-xs text-slate-500">رقم {s.studentNumber}</span>
                    </TD>
                    <TD>{e ? `${e.grade.name}${e.section ? ` - ${e.section.name}` : ''}` : '—'}</TD>
                    <TD>
                      <StatusBadge map={STUDENT_STATUS} value={s.status} />
                    </TD>
                    <TD numeric>{f.money(sm.gross)}</TD>
                    <TD numeric className="text-emerald-700">
                      {f.money(sm.discount, { hideZero: true })}
                    </TD>
                    <TD numeric>{f.money(sm.paid)}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(sm.balance, { colored: true })}
                    </TD>
                    <TD numeric className="text-rose-600">
                      {f.money(sm.overdue, { hideZero: true })}
                    </TD>
                  </TR>
                )
              })}
            </tbody>
            <tfoot>
              <TFootRow>
                <TD colSpan={3}>إجمالي العائلة</TD>
                <TD numeric>{f.money(totals.gross)}</TD>
                <TD numeric>{f.money(totals.discount)}</TD>
                <TD numeric>{f.money(totals.paid)}</TD>
                <TD numeric>{f.money(totals.balance)}</TD>
                <TD numeric>{f.money(totals.overdue)}</TD>
              </TFootRow>
            </tfoot>
          </Table>
        </TableWrap>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">آخر الدفعات</h3>
        </div>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>السند</TH>
                <TH>التاريخ</TH>
                <TH>الطريقة</TH>
                <TH numeric>المبلغ</TH>
                <TH>الحالة</TH>
              </tr>
            </THead>
            <tbody>
              {receipts.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/receipts/${r.id}`} className="num text-brand-700">
                      {r.number}
                    </Link>
                  </TD>
                  <TD>{f.date(r.date)}</TD>
                  <TD>{PAYMENT_METHOD[r.paymentMethod]}</TD>
                  <TD numeric>{f.money(D(r.amount))}</TD>
                  <TD>
                    <StatusBadge map={DOC_STATUS} value={r.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </>
  )
}
