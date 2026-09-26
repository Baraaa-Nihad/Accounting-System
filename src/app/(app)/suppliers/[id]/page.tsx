import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Banknote, Phone, Truck } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listSupplierBills, supplierSummary } from '@/server/services/parties'
import { listVouchers } from '@/server/services/vouchers'
import { statementTarget } from '@/server/ledger/party-statements'
import { expenseCategories } from '@/server/ledger/accounts'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { DOC_STATUS, PAYMENT_METHOD } from '@/lib/labels'
import { D } from '@/lib/money'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/link-tabs'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatementView } from '@/components/ledger/statement-view'
import { SupplierDialog } from '@/components/parties/supplier-dialog'
import { BillDialog } from '@/components/parties/bill-dialog'
import { CancelDocButton } from '@/components/forms/cancel-doc-button'
import { cancelBillAction } from '../actions'

export const metadata = { title: 'ملف المورد' }

const TABS = [
  { key: 'bills', label: 'الفواتير' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'statement', label: 'كشف الحساب' },
]

export default async function SupplierPage({ params, searchParams }: PageProps<'/suppliers/[id]'>) {
  const user = await requirePermission('suppliers.view')
  const { id } = await params
  const sp = await searchParams
  const supplier = await db.supplier.findUnique({ where: { id: Number(id) } })
  if (!supplier) notFound()
  const tab = TABS.find((t) => t.key === firstParam(sp.tab))?.key ?? 'bills'
  const [fmt, summary] = await Promise.all([getFormatConfig(), supplierSummary(db, supplier.id)])
  const f = makeFormatters(fmt)
  const balance = D(summary.balance)
  const manage = can(user, 'suppliers.manage')

  return (
    <>
      <PageHeader title="" breadcrumbs={[{ label: 'الموردون', href: '/suppliers' }, { label: supplier.name }]} />
      <div className="card -mt-4 mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
              <Truck className="size-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{supplier.name}</h1>
                {!supplier.isActive ? <Badge>غير فعال</Badge> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
                {supplier.category ? <span>{supplier.category}</span> : null}
                {supplier.contactPerson ? <span>المسؤول: {supplier.contactPerson}</span> : null}
                {supplier.phone ? (
                  <a href={`tel:${supplier.phone}`} className="flex items-center gap-1 hover:text-brand-700">
                    <Phone className="size-3.5" />
                    <bdi className="ltr num">{supplier.phone}</bdi>
                  </a>
                ) : null}
                {supplier.taxNumber ? <span>الرقم الضريبي: <span className="num">{supplier.taxNumber}</span></span> : null}
              </div>
              {supplier.notes ? <p className="mt-1 text-sm text-slate-500">{supplier.notes}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user, 'vouchers.create') ? (
              <Button asChild>
                <Link href={`/vouchers/new?kind=SUPPLIER_PAYMENT&supplierId=${supplier.id}`}>
                  <Banknote />
                  دفعة للمورد
                </Link>
              </Button>
            ) : null}
            {manage ? (
              <SupplierDialog
                initial={{
                  id: supplier.id,
                  name: supplier.name,
                  category: supplier.category ?? '',
                  phone: supplier.phone ?? '',
                  email: supplier.email ?? '',
                  contactPerson: supplier.contactPerson ?? '',
                  address: supplier.address ?? '',
                  taxNumber: supplier.taxNumber ?? '',
                  notes: supplier.notes ?? '',
                  isActive: supplier.isActive,
                }}
              />
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-slate-100 bg-slate-50/50">
          {[
            { label: `إجمالي الفواتير (${summary.billsCount})`, value: f.money(summary.bills), cls: '' },
            { label: 'إجمالي المدفوع', value: f.money(summary.paid), cls: 'text-emerald-700' },
            { label: balance.isNegative() ? 'دفعات مقدمة للمورد' : 'المستحق للمورد', value: f.money(balance.abs()), cls: balance.greaterThan(0) ? 'text-rose-600' : 'text-emerald-700' },
          ].map((x, i) => (
            <div key={i} className={cn('border-slate-100 px-5 py-3.5', i > 0 && 'border-s')}>
              <p className="text-xs text-slate-500">{x.label}</p>
              <p className={cn('mt-0.5 text-lg font-bold', x.cls)}>{x.value}</p>
            </div>
          ))}
        </div>
      </div>
      <LinkTabs className="mb-5" active={tab} tabs={TABS.map((t) => ({ ...t, href: `/suppliers/${supplier.id}?tab=${t.key}` }))} />
      {tab === 'bills' ? <BillsTab supplierId={supplier.id} f={f} manage={manage} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'payments' ? <PaymentsTab supplierId={supplier.id} f={f} page={intParam(sp.page)} sp={sp} /> : null}
      {tab === 'statement' ? (
        <StatementView
          target={(await statementTarget(db, 'supplier', supplier.id))!}
          from={isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null}
          to={isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null}
          hideReversed={firstParam(sp.hide) === '1'}
          f={f}
          canExport={can(user, 'reports.export')}
        />
      ) : null}
    </>
  )
}

type F = ReturnType<typeof makeFormatters>
type SP = Awaited<PageProps<'/suppliers/[id]'>['searchParams']>

async function BillsTab({ supplierId, f, manage, page, sp }: { supplierId: number; f: F; manage: boolean; page?: number; sp: SP }) {
  const [data, categories] = await Promise.all([listSupplierBills(db, { supplierId, page }), manage ? expenseCategories(db) : []])
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <p className="text-sm text-slate-500">الفواتير بالآجل والأرصدة الافتتاحية للمورد</p>
        {manage ? <BillDialog supplierId={supplierId} expenseAccounts={categories.map((c) => ({ id: c.id, name: c.name }))} /> : null}
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد فواتير" description="سجّل فاتورة عند الشراء بالآجل من المورد." />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الرقم</TH>
                <TH>التاريخ</TH>
                <TH>رقم فاتورة المورد</TH>
                <TH>نوع المصروف</TH>
                <TH>البيان</TH>
                <TH>الاستحقاق</TH>
                <TH numeric>المبلغ</TH>
                <TH>الحالة</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {data.rows.map((b) => (
                <TR key={b.id} className={b.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                  <TD>
                    <Link href={`/suppliers/bills/${b.id}`} className="num font-semibold text-brand-700 hover:underline">
                      {b.number}
                    </Link>
                  </TD>
                  <TD>{f.date(b.date)}</TD>
                  <TD className="num">{b.supplierInvoiceNo ?? '—'}</TD>
                  <TD>{b.isOpening ? <Badge tone="violet">رصيد افتتاحي</Badge> : b.expenseAccount.name}</TD>
                  <TD className="max-w-60 truncate text-slate-600">{b.description ?? '—'}</TD>
                  <TD>{b.dueDate ? f.date(b.dueDate) : '—'}</TD>
                  <TD numeric className="font-semibold">
                    {f.money(b.amount)}
                  </TD>
                  <TD>
                    <StatusBadge map={DOC_STATUS} value={b.status} />
                  </TD>
                  <TD>
                    {b.status === 'ACTIVE' && manage ? (
                      <CancelDocButton
                        id={b.id}
                        action={cancelBillAction}
                        title={`إلغاء الفاتورة ${b.number}`}
                        description="يُعكس قيد الفاتورة فينقص المستحق للمورد. تبقى الفاتورة ظاهرة بحالة «ملغي»."
                        label="إلغاء الفاتورة"
                        iconOnly
                      />
                    ) : null}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={`/suppliers/${supplierId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}

async function PaymentsTab({ supplierId, f, page, sp }: { supplierId: number; f: F; page?: number; sp: SP }) {
  const data = await listVouchers({ supplierId, page })
  return (
    <div className="card overflow-hidden">
      {data.rows.length === 0 ? (
        <EmptyState title="لا توجد دفعات" description="الدفعات للمورد تُسجل بسند صرف «دفعة لمورد»." />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>رقم السند</TH>
                <TH>التاريخ</TH>
                <TH>النوع</TH>
                <TH>البيان</TH>
                <TH>الطريقة</TH>
                <TH numeric>المبلغ</TH>
                <TH>الحالة</TH>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((v) => (
                <TR key={v.id} className={v.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                  <TD>
                    <Link href={`/vouchers/${v.id}`} className="num font-semibold text-brand-700 hover:underline">
                      {v.number}
                    </Link>
                  </TD>
                  <TD>{f.date(v.date)}</TD>
                  <TD>{v.kind === 'EXPENSE' ? `مصروف نقدي${v.expenseAccount ? ` — ${v.expenseAccount.name}` : ''}` : 'دفعة'}</TD>
                  <TD className="max-w-60 truncate text-slate-600">{v.description ?? '—'}</TD>
                  <TD>{PAYMENT_METHOD[v.paymentMethod]}</TD>
                  <TD numeric className="font-semibold">
                    {f.money(v.amount)}
                  </TD>
                  <TD>
                    <StatusBadge map={DOC_STATUS} value={v.status} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={`/suppliers/${supplierId}`} params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </div>
  )
}
