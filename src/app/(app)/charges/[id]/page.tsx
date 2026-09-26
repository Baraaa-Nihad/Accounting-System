import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getChargeDetails, discountTypesList } from '@/server/services/charges'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { ChargeActions } from '@/components/charges/charge-actions'
import { DiscountDialog } from '@/components/charges/discount-dialog'
import { DiscountCancelButton } from '@/components/charges/discount-cancel-button'
import { AuditTrail } from '@/components/audit/audit-trail'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { DISCOUNT_SCOPE, DOC_STATUS, INSTALLMENT_DISPLAY, PAYMENT_STATUS } from '@/lib/labels'
import { installmentDisplayStatus } from '@/lib/schedule'
import { todayInTimeZone, toDateOnly } from '@/lib/dates'
import { D, sum } from '@/lib/money'
import { listYears } from '@/server/years'

export const metadata = { title: 'تفاصيل الذمة' }

export default async function ChargePage({ params }: PageProps<'/charges/[id]'>) {
  const user = await requirePermission('charges.view')
  const { id } = await params
  const charge = await getChargeDetails(db, Number(id))
  if (!charge) notFound()
  const [fmt, settings, dtypes, years] = await Promise.all([getFormatConfig(), getSettings(), discountTypesList(), listYears()])
  const f = makeFormatters(fmt)
  const today = todayInTimeZone(settings.finance.timezone)
  const remaining = D(charge.netAmount).minus(D(charge.paidAmount))
  const cancelled = charge.status === 'CANCELLED'
  const activeInst = charge.installments.filter((i) => i.status !== 'CANCELLED')
  return (
    <>
      <PageHeader
        title={`${charge.chargeType.name}${charge.description ? ` — ${charge.description}` : ''}`}
        description={
          <span>
            الطالب:{' '}
            <Link href={`/students/${charge.studentId}`} className="font-medium text-brand-700">
              {charge.student.fullName}
            </Link>{' '}
            · السنة <bdi className="ltr num">{charge.academicYear.name}</bdi> · أضافها {charge.createdBy?.fullName ?? '—'}
          </span>
        }
        breadcrumbs={[{ label: 'الذمم والأقساط', href: '/charges' }, { label: charge.student.fullName, href: `/students/${charge.studentId}` }, { label: charge.chargeType.name }]}
        actions={
          <>
            {!cancelled && can(user, 'discounts.create') && remaining.greaterThan(0) ? (
              <DiscountDialog
                studentId={charge.studentId}
                presetChargeId={charge.id}
                charges={[
                  {
                    id: charge.id,
                    label: charge.chargeType.name,
                    chargeTypeId: charge.chargeTypeId,
                    chargeTypeName: charge.chargeType.name,
                    academicYearId: charge.academicYearId,
                    gross: charge.grossAmount.toString(),
                    net: charge.netAmount.toString(),
                    paid: charge.paidAmount.toString(),
                  },
                ]}
                discountTypes={dtypes.map((t) => ({ id: t.id, name: t.name, defaultMethod: t.defaultMethod, defaultValue: t.defaultValue?.toString() ?? null }))}
                years={years.map((y) => ({ id: y.id, name: y.name, status: y.status }))}
                defaultYearId={charge.academicYearId}
              />
            ) : null}
            <ChargeActions chargeId={charge.id} remaining={remaining.toString()} paid={charge.paidAmount.toString()} cancelled={cancelled} />
          </>
        }
      />
      {cancelled ? (
        <div className="mb-5 rounded-2xl border border-slate-300 bg-slate-100 p-4 text-slate-700">
          <p className="font-semibold">هذه الذمة ملغاة</p>
          <p className="text-sm">
            بتاريخ {f.dateTime(charge.cancelledAt)} — السبب: {charge.cancelReason}
          </p>
        </div>
      ) : null}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          ['المبلغ قبل الخصم', f.money(charge.grossAmount)],
          ['الخصم', f.money(charge.discountAmount)],
          ['المبلغ بعد الخصم', f.money(charge.netAmount)],
          ['المدفوع', f.money(charge.paidAmount)],
          ['المتبقي', f.money(cancelled ? 0 : remaining)],
        ].map(([l, v], i) => (
          <div key={i} className="card p-4">
            <p className="text-sm text-slate-500">{l}</p>
            <p className="mt-1 text-xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`جدول الأقساط (${activeInst.length})`} actions={cancelled ? null : <StatusBadge map={PAYMENT_STATUS} value={charge.paymentStatus} />} />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>القسط</TH>
                  <TH>تاريخ الاستحقاق</TH>
                  <TH numeric>القيمة</TH>
                  <TH numeric>المدفوع</TH>
                  <TH numeric>المتبقي</TH>
                  <TH>الحالة</TH>
                  <TH>الدفعات</TH>
                </tr>
              </THead>
              <tbody>
                {charge.installments.map((i) => {
                  const st = installmentDisplayStatus({ status: i.status, dueDate: toDateOnly(i.dueDate), amount: i.amount.toString(), paidAmount: i.paidAmount.toString() }, today, settings.finance.graceDays)
                  const allocs = i.allocations.filter((a) => a.receipt.status === 'ACTIVE')
                  return (
                    <TR key={i.id} className={i.status === 'CANCELLED' ? 'text-slate-400' : undefined}>
                      <TD className="num">{i.number}</TD>
                      <TD>{f.date(i.dueDate)}</TD>
                      <TD numeric>{f.money(i.amount)}</TD>
                      <TD numeric>{f.money(i.paidAmount, { hideZero: true })}</TD>
                      <TD numeric className="font-semibold">
                        {i.status === 'CANCELLED' ? '—' : f.money(D(i.amount).minus(D(i.paidAmount)), { hideZero: true })}
                      </TD>
                      <TD>
                        {i.status === 'CANCELLED' ? (
                          <Badge tone="gray">ملغي{i.cancelReason ? `: ${i.cancelReason}` : ''}</Badge>
                        ) : D(i.amount).isZero() ? (
                          <Badge tone="teal">لا يوجد مستحق</Badge>
                        ) : (
                          <StatusBadge map={INSTALLMENT_DISPLAY} value={st} />
                        )}
                      </TD>
                      <TD className="text-xs">
                        {allocs.map((a) => (
                          <Link key={a.id} href={`/receipts/${a.receipt.id}`} className="num me-2 text-brand-700">
                            {a.receipt.number}
                          </Link>
                        ))}
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
              <tfoot>
                <TFootRow>
                  <TD colSpan={2}>الإجمالي (غير الملغاة)</TD>
                  <TD numeric>{f.money(sum(activeInst.map((i) => i.amount)))}</TD>
                  <TD numeric>{f.money(sum(activeInst.map((i) => i.paidAmount)))}</TD>
                  <TD numeric>{f.money(sum(activeInst.map((i) => D(i.amount).minus(D(i.paidAmount)))))}</TD>
                  <TD colSpan={2} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="الخصومات على هذه الذمة" />
            <CardBody className="space-y-3">
              {charge.discountApplications.length === 0 ? (
                <p className="text-sm text-slate-500">لا توجد خصومات.</p>
              ) : (
                charge.discountApplications.map((a) => (
                  <div key={a.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.discount.discountType?.name ?? 'خصم'}</span>
                      <span className="flex items-center gap-1">
                        <StatusBadge map={DOC_STATUS} value={a.discount.status} />
                        {a.discount.status === 'ACTIVE' && can(user, 'discounts.cancel') ? <DiscountCancelButton discountId={a.discount.id} /> : null}
                      </span>
                    </div>
                    <p className="mt-1">
                      {a.discount.method === 'PERCENT' ? `${D(a.discount.value).toString()}%` : 'مبلغ ثابت'} — {f.money(a.amount)} ({DISCOUNT_SCOPE[a.discount.scope]})
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.discount.reason}
                      {a.discount.approvedBy ? ` — بموافقة ${a.discount.approvedBy}` : ''} — {f.dateText(a.discount.date)} — {a.discount.createdBy?.fullName}
                    </p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
          {charge.notes ? (
            <Card>
              <CardHeader title="ملاحظات" />
              <CardBody className="whitespace-pre-line text-sm">{charge.notes}</CardBody>
            </Card>
          ) : null}
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AttachmentsPanel entityType="Charge" entityId={charge.id} canUpload={can(user, 'charges.edit') || can(user, 'charges.create')} />
        {can(user, 'audit.view') ? <AuditTrail entityType="Charge" entityId={charge.id} /> : null}
      </div>
    </>
  )
}
