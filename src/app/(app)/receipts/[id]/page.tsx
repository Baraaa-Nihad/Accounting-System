import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getReceipt, openInstallments } from '@/server/services/receipts'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { amountToArabicWords } from '@/lib/tafqeet'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { ReceiptActions, type ReallocRow } from '@/components/receipts/receipt-actions'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { AuditTrail } from '@/components/audit/audit-trail'
import { CHEQUE_STATUS, DOC_STATUS, PAYMENT_METHOD, RECEIPT_KIND } from '@/lib/labels'
import { D } from '@/lib/money'
import { toDateOnly } from '@/lib/dates'

export const metadata = { title: 'سند قبض' }

export default async function ReceiptPage({ params }: PageProps<'/receipts/[id]'>) {
  const user = await requirePermission('receipts.view')
  const { id } = await params
  const receipt = await getReceipt(db, Number(id))
  if (!receipt) notFound()
  const fmt = await getFormatConfig()
  const f = makeFormatters(fmt)

  // بيانات إعادة التوزيع
  let realloc: ReallocRow[] | null = null
  const shares = new Map<number, { studentName: string; share: ReturnType<typeof D> }>()
  for (const a of receipt.allocations) {
    if (a.refundVoucherId) continue
    const s = shares.get(a.studentId) ?? { studentName: a.student.fullName, share: D(0) }
    s.share = s.share.plus(D(a.amount))
    shares.set(a.studentId, s)
  }
  if (receipt.status === 'ACTIVE' && shares.size > 0 && !receipt.allocations.some((a) => a.refundVoucherId)) {
    const open = await openInstallments(db, [...shares.keys()])
    const current = new Map<number, ReturnType<typeof D>>()
    for (const a of receipt.allocations) if (a.installmentId) current.set(a.installmentId, (current.get(a.installmentId) ?? D(0)).plus(D(a.amount)))
    const rows = new Map<number, ReallocRow>()
    for (const o of open) {
      rows.set(o.id, {
        installmentId: o.id,
        studentId: o.studentId,
        studentName: o.studentName,
        label: `${o.chargeTypeName}${o.installmentCount > 1 ? ` — القسط ${o.number}` : ''} (${o.yearName})`,
        dueDate: o.dueDate,
        available: D(o.remaining).plus(current.get(o.id) ?? 0).toString(),
        current: (current.get(o.id) ?? D(0)).toString(),
      })
    }
    for (const a of receipt.allocations) {
      if (!a.installmentId || rows.has(a.installmentId) || !a.installment || !a.charge) continue
      rows.set(a.installmentId, {
        installmentId: a.installmentId,
        studentId: a.studentId,
        studentName: a.student.fullName,
        label: `${a.charge.chargeType.name}${a.charge.installmentCount > 1 ? ` — القسط ${a.installment.number}` : ''} (${a.charge.academicYear.name})`,
        dueDate: toDateOnly(a.installment.dueDate),
        available: D(a.installment.amount).minus(D(a.installment.paidAmount)).plus(current.get(a.installmentId) ?? 0).toString(),
        current: (current.get(a.installmentId) ?? D(0)).toString(),
      })
    }
    realloc = [...rows.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }

  return (
    <>
      <PageHeader
        title={`سند قبض ${receipt.number}`}
        breadcrumbs={[{ label: 'سندات القبض', href: '/receipts' }, { label: receipt.number }]}
        actions={
          <ReceiptActions
            receiptId={receipt.id}
            cancelled={receipt.status === 'CANCELLED'}
            hasCheque={!!receipt.cheque}
            realloc={realloc}
            shares={[...shares.entries()].map(([sid, s]) => ({ studentId: sid, studentName: s.studentName, share: s.share.toString() }))}
          />
        }
      />
      {receipt.status === 'CANCELLED' ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">هذا السند ملغي</p>
          <p className="text-sm">
            ألغاه {receipt.cancelledBy?.fullName ?? '—'} بتاريخ {f.dateTime(receipt.cancelledAt)} — السبب: {receipt.cancelReason}
          </p>
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="بيانات السند" actions={<StatusBadge map={DOC_STATUS} value={receipt.status} />} />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">المبلغ</dt>
                <dd className="text-2xl font-bold">{f.money(receipt.amount)}</dd>
                <dd className="text-xs text-slate-500">{amountToArabicWords(Number(receipt.amount), fmt.currencyCode)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">التاريخ</dt>
                <dd className="font-medium">{f.date(receipt.date)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">الدافع</dt>
                <dd className="font-medium">{receipt.payerName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">النوع</dt>
                <dd>{RECEIPT_KIND[receipt.kind]}</dd>
              </div>
              <div>
                <dt className="text-slate-500">طريقة الدفع</dt>
                <dd>
                  {PAYMENT_METHOD[receipt.paymentMethod]}
                  {receipt.referenceNumber ? <span className="num text-slate-500"> — {receipt.referenceNumber}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">استلم في</dt>
                <dd>{receipt.cashAccount?.name ?? (receipt.cheque ? 'حافظة الشيكات' : '—')}</dd>
              </div>
              {receipt.cheque ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">الشيك</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    رقم <b className="num">{receipt.cheque.number}</b> {receipt.cheque.bankName ? `— ${receipt.cheque.bankName}` : ''} — يستحق {f.date(receipt.cheque.dueDate)}
                    <StatusBadge map={CHEQUE_STATUS} value={receipt.cheque.status} />
                  </dd>
                </div>
              ) : null}
              {receipt.revenueAccount ? (
                <div>
                  <dt className="text-slate-500">تصنيف الإيراد</dt>
                  <dd>{receipt.revenueAccount.name}</dd>
                </div>
              ) : null}
              {receipt.partner ? (
                <div>
                  <dt className="text-slate-500">الشريك</dt>
                  <dd>{receipt.partner.name}</dd>
                </div>
              ) : null}
              {receipt.description ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">البيان</dt>
                  <dd>{receipt.description}</dd>
                </div>
              ) : null}
              {receipt.notes ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">ملاحظات</dt>
                  <dd className="whitespace-pre-line">{receipt.notes}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-500">أنشأه</dt>
                <dd>
                  {receipt.createdBy?.fullName} — {f.dateTime(receipt.createdAt)}
                </dd>
              </div>
              {receipt.journalEntryId && can(user, 'accounting.view') ? (
                <div>
                  <dt className="text-slate-500">القيد المحاسبي</dt>
                  <dd>
                    <Link href={`/accounting/journal/${receipt.journalEntryId}`} className="text-brand-700 hover:underline">
                      عرض القيد
                    </Link>
                    {receipt.reversalEntryId ? (
                      <>
                        {' · '}
                        <Link href={`/accounting/journal/${receipt.reversalEntryId}`} className="text-brand-700 hover:underline">
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
        <Card>
          <CardHeader title="توزيع المبلغ" />
          {receipt.allocations.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">سند غير مرتبط بطلاب.</p>
            </CardBody>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>البيان</TH>
                    <TH numeric>المبلغ</TH>
                  </tr>
                </THead>
                <tbody>
                  {receipt.allocations.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={`/students/${a.studentId}`} className="block text-xs text-slate-500 hover:text-brand-700">
                          {a.student.fullName}
                        </Link>
                        {a.charge ? (
                          <Link href={`/charges/${a.chargeId}`} className="hover:text-brand-700">
                            {a.charge.chargeType.name}
                            {a.charge.installmentCount > 1 && a.installment ? ` — القسط ${a.installment.number}` : ''}
                          </Link>
                        ) : a.refundVoucher ? (
                          <span>
                            مرتجع —{' '}
                            <Link href={`/vouchers/${a.refundVoucher.id}`} className="num text-brand-700">
                              {a.refundVoucher.number}
                            </Link>
                          </span>
                        ) : (
                          <Badge tone="teal">رصيد دائن</Badge>
                        )}
                      </TD>
                      <TD numeric className="font-semibold">
                        {f.money(a.amount)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AttachmentsPanel entityType="Receipt" entityId={receipt.id} canUpload={can(user, 'receipts.create')} />
        {can(user, 'audit.view') ? <AuditTrail entityType="Receipt" entityId={receipt.id} /> : null}
      </div>
    </>
  )
}
