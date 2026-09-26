import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, Phone, Users, FileText, Printer, GraduationCap, CalendarDays } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getStudentProfile, studentFinancialSummary } from '@/server/services/students'
import { chargeTypesList, discountTypesList, studentCharges } from '@/server/services/charges'
import { getSelectedYear } from '@/server/context-year'
import { getFormatConfig, getSettings } from '@/server/settings'
import { listYears } from '@/server/years'
import { statement, sourceHref } from '@/server/ledger/statements'
import { accountIdByKey } from '@/server/ledger/accounts'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/link-tabs'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { AddChargeDialog } from '@/components/charges/add-charge-dialog'
import { DiscountDialog } from '@/components/charges/discount-dialog'
import { StudentStatusDialog } from '@/components/students/student-status-dialog'
import { StudentChargesTable } from '@/components/students/student-charges-table'
import { QuickPaymentDialog } from '@/components/receipts/quick-payment-dialog'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { StatementFilters } from '@/components/students/statement-filters'
import { INSTALLMENT_DISPLAY, PAYMENT_METHOD, STUDENT_STATUS, DOC_STATUS, GENDER, ENROLLMENT_STATUS } from '@/lib/labels'
import { installmentDisplayStatus } from '@/lib/schedule'
import { todayInTimeZone, toDateOnly } from '@/lib/dates'
import { D } from '@/lib/money'
import { firstParam } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const metadata = { title: 'ملف الطالب' }

const TABS = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'charges', label: 'الذمم' },
  { key: 'installments', label: 'الأقساط' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'statement', label: 'كشف الحساب' },
  { key: 'attachments', label: 'المرفقات' },
] as const

export default async function StudentPage({ params, searchParams }: PageProps<'/students/[id]'>) {
  const user = await requirePermission('students.view')
  const { id } = await params
  const sp = await searchParams
  const studentId = Number(id)
  const student = await getStudentProfile(db, studentId)
  if (!student) notFound()
  const tab = (TABS.find((t) => t.key === firstParam(sp.tab))?.key ?? 'overview') as (typeof TABS)[number]['key']

  const [summary, fmt, settings, selectedYear, years, chargeTypes, discountTypes] = await Promise.all([
    studentFinancialSummary(db, studentId),
    getFormatConfig(),
    getSettings(),
    getSelectedYear(),
    listYears(),
    chargeTypesList(),
    discountTypesList(),
  ])
  const f = makeFormatters(fmt)
  const today = todayInTimeZone(settings.finance.timezone)
  const enrollment = student.enrollments.find((e) => e.academicYearId === selectedYear?.id) ?? student.enrollments[0]
  const siblings = student.guardian?.students.filter((s) => s.id !== student.id) ?? []
  const openYears = years.map((y) => ({ id: y.id, name: y.name, status: y.status }))
  const picked = {
    id: student.id,
    fullName: student.fullName,
    studentNumber: student.studentNumber,
    gradeName: enrollment?.grade.name,
    sectionName: enrollment?.section?.name,
    guardianName: student.guardian?.name,
  }
  const chargeTypeOptions = chargeTypes.map((t) => ({
    id: t.id,
    name: t.name,
    defaultAmount: t.defaultAmount?.toString() ?? null,
    allowInstallments: t.allowInstallments,
  }))
  const discountTypeOptions = discountTypes.map((t) => ({
    id: t.id,
    name: t.name,
    defaultMethod: t.defaultMethod,
    defaultValue: t.defaultValue?.toString() ?? null,
  }))
  const charges = await studentCharges(db, studentId, { includeCancelled: tab === 'charges' })
  const balance = D(summary.balance)

  return (
    <>
      <PageHeader
        title=""
        breadcrumbs={[{ label: 'الطلاب', href: '/students' }, { label: student.fullName }]}
      />

      {/* رأس ملف الطالب */}
      <div className="card -mt-4 mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <GraduationCap className="size-7" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{student.fullName}</h1>
                <StatusBadge map={STUDENT_STATUS} value={student.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                <span>
                  رقم الطالب: <b className="num text-slate-700">{student.studentNumber}</b>
                </span>
                {student.schoolNumber ? (
                  <span>
                    الرقم المدرسي: <b className="num text-slate-700">{student.schoolNumber}</b>
                  </span>
                ) : null}
                <span>
                  {enrollment ? `${enrollment.grade.name}${enrollment.section ? ` - ${enrollment.section.name}` : ''}` : 'غير مسجل في السنة المختارة'}
                </span>
                {student.guardian ? (
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    <Link href={`/families/${student.guardian.id}`} className="hover:text-brand-700">
                      {student.guardian.name}
                    </Link>
                  </span>
                ) : null}
                {student.guardian?.phone ? (
                  <a href={`tel:${student.guardian.phone}`} className="flex items-center gap-1 hover:text-brand-700">
                    <Phone className="size-3.5" />
                    <bdi className="ltr num">{student.guardian.phone}</bdi>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            {can(user, 'receipts.create') ? <QuickPaymentDialog student={picked} /> : null}
            {can(user, 'charges.create') ? (
              <AddChargeDialog
                student={picked}
                chargeTypes={chargeTypeOptions}
                discountTypes={discountTypeOptions}
                years={openYears}
                defaultYearId={selectedYear?.id ?? null}
                canDiscount={can(user, 'discounts.create')}
              />
            ) : null}
            {can(user, 'discounts.create') ? (
              <DiscountDialog
                studentId={student.id}
                charges={charges
                  .filter((c) => c.status === 'ACTIVE')
                  .map((c) => ({
                    id: c.id,
                    label: `${c.chargeType.name}${c.description ? ` — ${c.description}` : ''} (${c.academicYear.name})`,
                    chargeTypeId: c.chargeTypeId,
                    chargeTypeName: c.chargeType.name,
                    academicYearId: c.academicYearId,
                    gross: c.grossAmount.toString(),
                    net: c.netAmount.toString(),
                    paid: c.paidAmount.toString(),
                  }))}
                discountTypes={discountTypeOptions}
                years={openYears}
                defaultYearId={selectedYear?.id ?? null}
              />
            ) : null}
            {can(user, 'students.edit') ? (
              <>
                <Button variant="ghost" asChild>
                  <Link href={`/students/${student.id}/edit`}>
                    <Pencil />
                    تعديل
                  </Link>
                </Button>
                <StudentStatusDialog studentId={student.id} current={student.status} />
              </>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/50 sm:grid-cols-5">
          {[
            { label: 'إجمالي الذمم', value: f.money(summary.gross), cls: '' },
            { label: 'إجمالي المدفوع', value: f.money(summary.paid), cls: 'text-emerald-700' },
            { label: 'إجمالي الخصومات', value: f.money(summary.discount), cls: 'text-sky-700' },
            {
              label: balance.isNegative() ? 'رصيد دائن للطالب' : 'المتبقي',
              value: f.money(balance.abs()),
              cls: balance.greaterThan(0) ? 'text-rose-600' : 'text-emerald-700',
            },
            { label: 'منه متأخر', value: f.money(summary.overdue), cls: D(summary.overdue).greaterThan(0) ? 'text-rose-600' : 'text-slate-400' },
          ].map((x, i) => (
            <div key={i} className={cn('border-slate-100 px-5 py-3.5', i > 0 && 'sm:border-s')}>
              <p className="text-xs text-slate-500">{x.label}</p>
              <p className={cn('mt-0.5 text-lg font-bold', x.cls)}>{x.value}</p>
            </div>
          ))}
        </div>
      </div>

      <LinkTabs
        className="mb-5"
        active={tab}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/students/${student.id}?tab=${t.key}` }))}
      />

      {tab === 'overview' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="الأقساط القادمة والمستحقة" actions={<Link href={`/students/${student.id}?tab=installments`} className="text-sm text-brand-700">عرض الكل</Link>} />
            {(() => {
              const upcoming = charges
                .flatMap((c) => c.installments.map((i) => ({ ...i, typeName: c.chargeType.name })))
                .filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL')
                .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
                .slice(0, 6)
              if (!upcoming.length) return <EmptyState title="لا توجد أقساط مستحقة" description="كل الذمم مسددة أو لا توجد ذمم بعد." />
              return (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <TH>الذمة</TH>
                        <TH>تاريخ الاستحقاق</TH>
                        <TH numeric>القيمة</TH>
                        <TH numeric>المتبقي</TH>
                        <TH>الحالة</TH>
                      </tr>
                    </THead>
                    <tbody>
                      {upcoming.map((i) => {
                        const st = installmentDisplayStatus(
                          { status: i.status, dueDate: toDateOnly(i.dueDate), amount: i.amount.toString(), paidAmount: i.paidAmount.toString() },
                          today,
                          settings.finance.graceDays,
                        )
                        return (
                          <TR key={i.id}>
                            <TD>
                              {i.typeName} <span className="text-xs text-slate-400">— القسط {i.number}</span>
                            </TD>
                            <TD>{f.date(i.dueDate)}</TD>
                            <TD numeric>{f.money(i.amount)}</TD>
                            <TD numeric className="font-semibold">
                              {f.money(D(i.amount).minus(D(i.paidAmount)))}
                            </TD>
                            <TD>
                              <StatusBadge map={INSTALLMENT_DISPLAY} value={st} />
                            </TD>
                          </TR>
                        )
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              )
            })()}
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="بيانات الطالب" />
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-slate-500">الجنس</dt>
                    <dd>{student.gender ? GENDER[student.gender] : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">تاريخ الميلاد</dt>
                    <dd>{student.birthDate ? f.date(student.birthDate) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">الرقم الوطني</dt>
                    <dd className="num">{student.nationalId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">تاريخ الالتحاق</dt>
                    <dd>{student.joinDate ? f.date(student.joinDate) : '—'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">العنوان</dt>
                    <dd>{student.address ?? '—'}</dd>
                  </div>
                  {student.statusReason ? (
                    <div className="col-span-2">
                      <dt className="text-slate-500">سبب آخر تغيير حالة</dt>
                      <dd>{student.statusReason}</dd>
                    </div>
                  ) : null}
                  {student.notes ? (
                    <div className="col-span-2">
                      <dt className="text-slate-500">ملاحظات</dt>
                      <dd className="whitespace-pre-line">{student.notes}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="العائلة" description={student.guardian ? `ولي الأمر: ${student.guardian.name}` : undefined} actions={student.guardian ? <Link href={`/families/${student.guardian.id}`} className="text-sm text-brand-700">حساب العائلة</Link> : null} />
              <CardBody className="space-y-2">
                {siblings.length === 0 ? (
                  <p className="text-sm text-slate-500">لا يوجد إخوة مسجلون.</p>
                ) : (
                  siblings.map((s) => (
                    <Link key={s.id} href={`/students/${s.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <span>{s.fullName}</span>
                      <StatusBadge map={STUDENT_STATUS} value={s.status} />
                    </Link>
                  ))
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="سجل التسجيل الدراسي" />
              <CardBody className="space-y-2 text-sm">
                {student.enrollments.map((e) => (
                  <div key={e.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CalendarDays className="size-4 text-slate-400" />
                      <bdi className="ltr num">{e.academicYear.name}</bdi>
                    </span>
                    <span>
                      {e.grade.name}
                      {e.section ? ` - ${e.section.name}` : ''} <span className="text-xs text-slate-400">({ENROLLMENT_STATUS[e.status]})</span>
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'charges' ? (
        <div className="card overflow-hidden">
          {charges.length === 0 ? (
            <EmptyState icon={<FileText />} title="لا توجد ذمم على هذا الطالب" description="أضف ذمة (رسوم، كتب، زي...) من زر «إضافة ذمة» أعلاه." />
          ) : (
            <StudentChargesTable
              studentId={student.id}
              discountTypes={discountTypeOptions}
              years={openYears}
              defaultYearId={selectedYear?.id ?? null}
              rows={charges.map((c) => ({
                id: c.id,
                typeName: c.chargeType.name,
                description: c.description,
                yearName: c.academicYear.name,
                academicYearId: c.academicYearId,
                chargeTypeId: c.chargeTypeId,
                date: toDateOnly(c.date),
                gross: c.grossAmount.toString(),
                discount: c.discountAmount.toString(),
                net: c.netAmount.toString(),
                paid: c.paidAmount.toString(),
                status: c.status,
                paymentStatus: c.paymentStatus,
                installmentCount: c.installmentCount,
                cancelReason: c.cancelReason,
              }))}
            />
          )}
        </div>
      ) : null}

      {tab === 'installments' ? (
        <div className="card overflow-hidden">
          {(() => {
            const rows = charges
              .flatMap((c) => c.installments.map((i) => ({ ...i, typeName: c.chargeType.name, chargeId: c.id, yearName: c.academicYear.name })))
              .filter((i) => i.status !== 'CANCELLED')
              .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
            if (!rows.length) return <EmptyState title="لا توجد أقساط" />
            return (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>الذمة</TH>
                      <TH>القسط</TH>
                      <TH>تاريخ الاستحقاق</TH>
                      <TH numeric>قيمة القسط</TH>
                      <TH numeric>المدفوع</TH>
                      <TH numeric>المتبقي</TH>
                      <TH>الحالة</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {rows.map((i) => {
                      const st = installmentDisplayStatus(
                        { status: i.status, dueDate: toDateOnly(i.dueDate), amount: i.amount.toString(), paidAmount: i.paidAmount.toString() },
                        today,
                        settings.finance.graceDays,
                      )
                      return (
                        <TR key={i.id}>
                          <TD>
                            <Link href={`/charges/${i.chargeId}`} className="hover:text-brand-700">
                              {i.typeName}
                            </Link>
                            <span className="ms-1 text-xs text-slate-400">({i.yearName})</span>
                          </TD>
                          <TD className="num">{i.number}</TD>
                          <TD>{f.date(i.dueDate)}</TD>
                          <TD numeric>{f.money(i.amount)}</TD>
                          <TD numeric>{f.money(i.paidAmount, { hideZero: true })}</TD>
                          <TD numeric className="font-semibold">
                            {f.money(D(i.amount).minus(D(i.paidAmount)), { hideZero: true })}
                          </TD>
                          <TD>
                            {D(i.amount).isZero() ? <Badge tone="teal">لا يوجد مستحق (خصم)</Badge> : <StatusBadge map={INSTALLMENT_DISPLAY} value={st} />}
                          </TD>
                        </TR>
                      )
                    })}
                  </tbody>
                </Table>
              </TableWrap>
            )
          })()}
        </div>
      ) : null}

      {tab === 'payments' ? <PaymentsTab studentId={student.id} f={f} /> : null}
      {tab === 'receipts' ? <ReceiptsTab studentId={student.id} f={f} /> : null}
      {tab === 'statement' ? (
        <StatementTab
          studentId={student.id}
          f={f}
          from={firstParam(sp.from) ?? null}
          to={firstParam(sp.to) ?? null}
          hideReversed={firstParam(sp.hide) === '1'}
          yearOptions={years.map((y) => ({ id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate }))}
        />
      ) : null}
      {tab === 'attachments' ? (
        <AttachmentsPanel entityType="Student" entityId={student.id} canUpload={can(user, 'students.edit')} />
      ) : null}
    </>
  )
}

type F = ReturnType<typeof makeFormatters>

async function PaymentsTab({ studentId, f }: { studentId: number; f: F }) {
  const allocations = await db.paymentAllocation.findMany({
    where: { studentId },
    include: {
      receipt: true,
      charge: { include: { chargeType: true } },
      installment: true,
      refundVoucher: { select: { id: true, number: true } },
    },
    orderBy: [{ receipt: { date: 'desc' } }, { id: 'desc' }],
    take: 500,
  })
  if (!allocations.length) return <div className="card"><EmptyState title="لا توجد دفعات بعد" description="سجّل دفعة من زر «تسجيل دفعة» أعلاه." /></div>
  return (
    <div className="card overflow-hidden">
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التاريخ</TH>
              <TH>سند القبض</TH>
              <TH>سُدد عن</TH>
              <TH numeric>المبلغ</TH>
              <TH>حالة السند</TH>
            </tr>
          </THead>
          <tbody>
            {allocations.map((a) => (
              <TR key={a.id} className={a.receipt.status === 'CANCELLED' ? 'opacity-50' : undefined}>
                <TD>{f.date(a.receipt.date)}</TD>
                <TD>
                  <Link href={`/receipts/${a.receiptId}`} className="num font-medium text-brand-700">
                    {a.receipt.number}
                  </Link>
                </TD>
                <TD>
                  {a.charge ? (
                    <>
                      {a.charge.chargeType.name}
                      {a.installment ? <span className="text-xs text-slate-500"> — القسط {a.installment.number}</span> : null}
                    </>
                  ) : a.refundVoucher ? (
                    <span className="text-slate-600">
                      مرتجع بالسند{' '}
                      <Link href={`/vouchers/${a.refundVoucher.id}`} className="num text-brand-700">
                        {a.refundVoucher.number}
                      </Link>
                    </span>
                  ) : (
                    <Badge tone="teal">رصيد دائن غير موزع</Badge>
                  )}
                </TD>
                <TD numeric className="font-semibold">
                  {f.money(a.amount)}
                </TD>
                <TD>
                  <StatusBadge map={DOC_STATUS} value={a.receipt.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  )
}

async function ReceiptsTab({ studentId, f }: { studentId: number; f: F }) {
  const receipts = await db.receipt.findMany({
    where: { OR: [{ studentId }, { allocations: { some: { studentId } } }] },
    include: { allocations: { where: { studentId } }, createdBy: { select: { fullName: true } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: 300,
  })
  if (!receipts.length) return <div className="card"><EmptyState title="لا توجد سندات قبض" /></div>
  return (
    <div className="card overflow-hidden">
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>رقم السند</TH>
              <TH>التاريخ</TH>
              <TH>الدافع</TH>
              <TH>طريقة الدفع</TH>
              <TH numeric>مبلغ السند</TH>
              <TH numeric>حصة الطالب</TH>
              <TH>بواسطة</TH>
              <TH>الحالة</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {receipts.map((r) => (
              <TR key={r.id} className={r.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                <TD>
                  <Link href={`/receipts/${r.id}`} className="num font-medium text-brand-700">
                    {r.number}
                  </Link>
                </TD>
                <TD>{f.date(r.date)}</TD>
                <TD>{r.payerName}</TD>
                <TD>{PAYMENT_METHOD[r.paymentMethod]}</TD>
                <TD numeric>{f.money(r.amount)}</TD>
                <TD numeric className="font-semibold">
                  {f.money(r.allocations.reduce((s, a) => s.plus(D(a.amount)), D(0)))}
                </TD>
                <TD className="text-slate-500">{r.createdBy?.fullName}</TD>
                <TD>
                  <StatusBadge map={DOC_STATUS} value={r.status} />
                </TD>
                <TD>
                  <Link href={`/print/receipts/${r.id}`} target="_blank" className="text-slate-400 hover:text-brand-700" aria-label="طباعة">
                    <Printer className="size-4" />
                  </Link>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  )
}

async function StatementTab({
  studentId,
  f,
  from,
  to,
  hideReversed,
  yearOptions,
}: {
  studentId: number
  f: F
  from: string | null
  to: string | null
  hideReversed: boolean
  yearOptions: { id: number; name: string; startDate: string; endDate: string }[]
}) {
  const ar = await accountIdByKey(db, 'AR_STUDENTS')
  const st = await statement(db, { accountIds: [ar], studentId, from, to, hideReversed }, 1)
  const printQs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(hideReversed ? { hide: '1' } : {}) }).toString()
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
        <StatementFilters years={yearOptions} />
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href={`/print/students/${studentId}/statement${printQs ? `?${printQs}` : ''}`} target="_blank">
              <Printer />
              طباعة / PDF
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <a href={`/api/export/student-statement/${studentId}?format=xlsx${printQs ? `&${printQs}` : ''}`}>Excel</a>
          </Button>
        </div>
      </div>
      <p className="px-4 pt-3 text-xs text-slate-500">
        <b>مدين</b> = مبالغ مطلوبة من الطالب (ذمم، مرتجعات) · <b>دائن</b> = ما دفعه الطالب أو خُصم له · <b>الرصيد</b> الموجب = ما زال على الطالب
      </p>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التاريخ</TH>
              <TH>البيان</TH>
              <TH>المرجع</TH>
              <TH numeric>مدين</TH>
              <TH numeric>دائن</TH>
              <TH numeric>الرصيد</TH>
            </tr>
          </THead>
          <tbody>
            {from ? (
              <TR className="bg-slate-50">
                <TD>{f.date(from)}</TD>
                <TD colSpan={4} className="font-medium">
                  رصيد افتتاحي للفترة
                </TD>
                <TD numeric className="font-semibold">
                  {f.money(st.opening)}
                </TD>
              </TR>
            ) : null}
            {st.rows.length === 0 ? (
              <TR>
                <TD colSpan={6} className="py-10 text-center text-slate-500">
                  لا توجد حركات في هذه الفترة
                </TD>
              </TR>
            ) : (
              st.rows.map((r) => {
                const href = sourceHref(r.sourceType, r.sourceId)
                return (
                  <TR key={r.lineId} className={r.reversed || r.isReversal ? 'text-slate-400' : undefined}>
                    <TD>{f.date(r.date)}</TD>
                    <TD>
                      {r.description}
                      {r.reversed ? <Badge tone="gray" className="ms-2">أُلغي لاحقًا</Badge> : null}
                      {r.isReversal ? <Badge tone="gray" className="ms-2">قيد إلغاء</Badge> : null}
                    </TD>
                    <TD>
                      {href ? (
                        <Link href={href} className="num text-xs text-brand-700 hover:underline">
                          {r.entryNumber}
                        </Link>
                      ) : (
                        <span className="num text-xs text-slate-400">{r.entryNumber}</span>
                      )}
                    </TD>
                    <TD numeric>{f.money(r.debit, { hideZero: true })}</TD>
                    <TD numeric>{f.money(r.credit, { hideZero: true })}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(r.balance, { colored: true })}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
          <tfoot>
            <TFootRow>
              <TD colSpan={3}>الإجمالي والرصيد الختامي</TD>
              <TD numeric>{f.money(st.totalDebit)}</TD>
              <TD numeric>{f.money(st.totalCredit)}</TD>
              <TD numeric>{f.money(st.closing)}</TD>
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>
    </div>
  )
}
