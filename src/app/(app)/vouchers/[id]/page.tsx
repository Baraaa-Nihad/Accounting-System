import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getVoucher } from '@/server/services/vouchers'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { amountToArabicWords } from '@/lib/tafqeet'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { AuditTrail } from '@/components/audit/audit-trail'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { CHEQUE_STATUS, DOC_STATUS, PAYMENT_METHOD, VOUCHER_KIND } from '@/lib/labels'
import { cancelVoucherAction } from '../actions'

export const metadata = { title: 'سند صرف' }

export default async function VoucherPage({ params }: PageProps<'/vouchers/[id]'>) {
  const user = await requirePermission('vouchers.view')
  const { id } = await params
  const v = await getVoucher(db, Number(id))
  if (!v) notFound()
  const fmt = await getFormatConfig()
  const f = makeFormatters(fmt)
  const linked: { label: string; value: React.ReactNode }[] = []
  if (v.expenseAccount) linked.push({ label: v.kind === 'OTHER' ? 'الحساب' : 'نوع المصروف', value: v.expenseAccount.name })
  if (v.supplier) linked.push({ label: 'المورد', value: <Link href={`/suppliers/${v.supplier.id}`} className="text-brand-700 hover:underline">{v.supplier.name}</Link> })
  if (v.contractor) linked.push({ label: 'العامل/المقاول', value: <Link href={`/contractors/${v.contractor.id}`} className="text-brand-700 hover:underline">{v.contractor.name}</Link> })
  if (v.contractorJob) linked.push({ label: 'العمل', value: v.contractorJob.description })
  if (v.employee && can(user, 'employees.view')) linked.push({ label: 'الموظف', value: <Link href={`/employees/${v.employee.id}`} className="text-brand-700 hover:underline">{v.employee.fullName}</Link> })
  if (v.payrollItem) linked.push({ label: 'مسير الرواتب', value: <Link href={`/payroll/${v.payrollItem.payrollRunId}`} className="text-brand-700 hover:underline">شهر {v.payrollItem.payrollRun.month}/{v.payrollItem.payrollRun.year}</Link> })
  if (v.student) linked.push({ label: 'الطالب', value: <Link href={`/students/${v.student.id}`} className="text-brand-700 hover:underline">{v.student.fullName}</Link> })
  if (v.partner) linked.push({ label: 'الشريك', value: v.partner.name })

  return (
    <>
      <PageHeader
        title={`سند صرف ${v.number}`}
        breadcrumbs={[{ label: 'سندات الصرف', href: '/vouchers' }, { label: v.number }]}
        actions={
          <>
            <Button asChild>
              <Link href={`/print/vouchers/${v.id}`} target="_blank">
                <Printer />
                طباعة
              </Link>
            </Button>
            {v.status === 'ACTIVE' && can(user, 'vouchers.cancel') ? (
              <CancelDocButton
                id={v.id}
                action={cancelVoucherAction}
                title={`إلغاء سند الصرف ${v.number}`}
                description="يبقى السند محفوظًا برقمه بحالة «ملغي»، ويُعكس قيده فيعود المبلغ إلى الصندوق، وتُلغى آثاره (المدفوع للمقاول/الموظف، المرتجع...)."
                label="إلغاء السند"
              />
            ) : null}
          </>
        }
      />
      {v.status === 'CANCELLED' ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">هذا السند ملغي</p>
          <p className="text-sm">
            ألغاه {v.cancelledBy?.fullName ?? '—'} بتاريخ {f.dateTime(v.cancelledAt)} — السبب: {v.cancelReason}
          </p>
        </div>
      ) : null}
      <Card>
        <CardHeader title="بيانات السند" actions={<StatusBadge map={DOC_STATUS} value={v.status} />} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <dt className="text-slate-500">المبلغ</dt>
              <dd className="text-2xl font-bold">{f.money(v.amount)}</dd>
              <dd className="text-xs text-slate-500">{amountToArabicWords(Number(v.amount), fmt.currencyCode)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">التاريخ</dt>
              <dd className="font-medium">{f.date(v.date)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">النوع</dt>
              <dd>{VOUCHER_KIND[v.kind]}</dd>
            </div>
            <div>
              <dt className="text-slate-500">المستفيد</dt>
              <dd className="font-medium">{v.payeeName}</dd>
            </div>
            {linked.map((l) => (
              <div key={l.label}>
                <dt className="text-slate-500">{l.label}</dt>
                <dd>{l.value}</dd>
              </div>
            ))}
            <div>
              <dt className="text-slate-500">طريقة الدفع</dt>
              <dd>
                {PAYMENT_METHOD[v.paymentMethod]}
                {v.referenceNumber ? <span className="num text-slate-500"> — {v.referenceNumber}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">صُرف من</dt>
              <dd>
                <Link href={`/treasury/${v.cashAccount.id}`} className="hover:text-brand-700">
                  {v.cashAccount.name}
                </Link>
              </dd>
            </div>
            {v.cheque ? (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">الشيك</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  رقم <b className="num">{v.cheque.number}</b> — يستحق {f.date(v.cheque.dueDate)}
                  <StatusBadge map={CHEQUE_STATUS} value={v.cheque.status} />
                </dd>
              </div>
            ) : null}
            {v.description ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-slate-500">البيان</dt>
                <dd>{v.description}</dd>
              </div>
            ) : null}
            {v.notes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-slate-500">ملاحظات</dt>
                <dd className="whitespace-pre-line">{v.notes}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-slate-500">السنة الدراسية</dt>
              <dd>{v.academicYear.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">أنشأه</dt>
              <dd>
                {v.createdBy?.fullName} — {f.dateTime(v.createdAt)}
              </dd>
            </div>
            {v.journalEntryId && can(user, 'accounting.view') ? (
              <div>
                <dt className="text-slate-500">القيد المحاسبي</dt>
                <dd>
                  <Link href={`/accounting/journal/${v.journalEntryId}`} className="text-brand-700 hover:underline">
                    عرض القيد
                  </Link>
                  {v.reversalEntryId ? (
                    <>
                      {' · '}
                      <Link href={`/accounting/journal/${v.reversalEntryId}`} className="text-brand-700 hover:underline">
                        قيد الإلغاء
                      </Link>
                    </>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AttachmentsPanel entityType="PaymentVoucher" entityId={v.id} canUpload={can(user, 'vouchers.edit') || can(user, 'vouchers.create')} />
        {can(user, 'audit.view') ? <AuditTrail entityType="PaymentVoucher" entityId={v.id} /> : null}
      </div>
    </>
  )
}
