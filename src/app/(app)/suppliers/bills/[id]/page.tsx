import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSupplierBill } from '@/server/services/parties'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { DOC_STATUS } from '@/lib/labels'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { AuditTrail } from '@/components/audit/audit-trail'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { cancelBillAction } from '../../actions'

export const metadata = { title: 'فاتورة مورد' }

export default async function BillPage({ params }: PageProps<'/suppliers/bills/[id]'>) {
  const user = await requirePermission('suppliers.view')
  const { id } = await params
  const bill = await getSupplierBill(db, Number(id))
  if (!bill) notFound()
  const f = makeFormatters(await getFormatConfig())
  return (
    <>
      <PageHeader
        title={`${bill.isOpening ? 'رصيد افتتاحي' : 'فاتورة'} ${bill.number}`}
        breadcrumbs={[{ label: 'الموردون', href: '/suppliers' }, { label: bill.supplier.name, href: `/suppliers/${bill.supplierId}` }, { label: bill.number }]}
        actions={
          bill.status === 'ACTIVE' && can(user, 'suppliers.manage') ? (
            <CancelDocButton
              id={bill.id}
              action={cancelBillAction}
              title={`إلغاء الفاتورة ${bill.number}`}
              description="يُعكس قيد الفاتورة فينقص المستحق للمورد. تبقى الفاتورة ظاهرة بحالة «ملغي»."
              label="إلغاء الفاتورة"
            />
          ) : null
        }
      />
      {bill.status === 'CANCELLED' ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <p className="font-semibold">هذه الفاتورة ملغاة</p>
          <p className="text-sm">
            بتاريخ {f.dateTime(bill.cancelledAt)} — السبب: {bill.cancelReason}
          </p>
        </div>
      ) : null}
      <Card>
        <CardHeader title="بيانات الفاتورة" actions={<StatusBadge map={DOC_STATUS} value={bill.status} />} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-slate-500">المبلغ</dt>
              <dd className="text-2xl font-bold">{f.money(bill.amount)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">المورد</dt>
              <dd>
                <Link href={`/suppliers/${bill.supplierId}`} className="text-brand-700 hover:underline">
                  {bill.supplier.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">التاريخ</dt>
              <dd>{f.date(bill.date)}</dd>
            </div>
            {bill.dueDate ? (
              <div>
                <dt className="text-slate-500">تاريخ الاستحقاق</dt>
                <dd>{f.date(bill.dueDate)}</dd>
              </div>
            ) : null}
            {bill.supplierInvoiceNo ? (
              <div>
                <dt className="text-slate-500">رقم فاتورة المورد</dt>
                <dd className="num">{bill.supplierInvoiceNo}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-slate-500">{bill.isOpening ? 'النوع' : 'نوع المصروف'}</dt>
              <dd>{bill.isOpening ? 'رصيد افتتاحي' : bill.expenseAccount.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">السنة الدراسية</dt>
              <dd>{bill.academicYear.name}</dd>
            </div>
            {bill.description ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-slate-500">البيان</dt>
                <dd>{bill.description}</dd>
              </div>
            ) : null}
            {bill.notes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-slate-500">ملاحظات</dt>
                <dd className="whitespace-pre-line">{bill.notes}</dd>
              </div>
            ) : null}
            {bill.journalEntryId && can(user, 'accounting.view') ? (
              <div>
                <dt className="text-slate-500">القيد المحاسبي</dt>
                <dd>
                  <Link href={`/accounting/journal/${bill.journalEntryId}`} className="text-brand-700 hover:underline">
                    عرض القيد
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AttachmentsPanel entityType="SupplierBill" entityId={bill.id} canUpload={can(user, 'suppliers.manage')} />
        {can(user, 'audit.view') ? <AuditTrail entityType="SupplierBill" entityId={bill.id} /> : null}
      </div>
    </>
  )
}
