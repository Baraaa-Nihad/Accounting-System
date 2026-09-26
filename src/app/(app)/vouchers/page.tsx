import Link from 'next/link'
import { Plus, Printer } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { listVouchers } from '@/server/services/vouchers'
import { getFormatConfig } from '@/server/settings'
import { db } from '@/server/db'
import { expenseCategories } from '@/server/ledger/accounts'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { CHEQUE_STATUS, DOC_STATUS, PAYMENT_METHOD, VOUCHER_KIND } from '@/lib/labels'
import { firstParam, intParam } from '@/lib/utils'
import { isDateOnly } from '@/lib/dates'

export const metadata = { title: 'سندات الصرف' }

export default async function VouchersPage({ searchParams }: PageProps<'/vouchers'>) {
  const user = await requirePermission('vouchers.view')
  const sp = await searchParams
  const [fmt, users, cashAccounts, categories] = await Promise.all([
    getFormatConfig(),
    db.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    db.cashAccount.findMany({ orderBy: { name: 'asc' } }),
    expenseCategories(db, false),
  ])
  const f = makeFormatters(fmt)
  const from = firstParam(sp.from)
  const to = firstParam(sp.to)
  const data = await listVouchers({
    q: firstParam(sp.q),
    from: isDateOnly(from) ? from : undefined,
    to: isDateOnly(to) ? to : undefined,
    kind: firstParam(sp.kind),
    method: firstParam(sp.method),
    status: firstParam(sp.status),
    userId: intParam(sp.user),
    cashAccountId: intParam(sp.account),
    expenseAccountId: intParam(sp.category),
    supplierId: intParam(sp.supplier),
    contractorId: intParam(sp.contractor),
    employeeId: intParam(sp.employee),
    minAmount: firstParam(sp.min),
    maxAmount: firstParam(sp.max),
    page: intParam(sp.page),
  })

  return (
    <>
      <PageHeader
        title="سندات الصرف"
        description="كل المبالغ المصروفة: المصروفات، دفعات الموردين والمقاولين، الرواتب، السلف، المرتجعات، ومسحوبات الشركاء."
        actions={
          can(user, 'vouchers.create') ? (
            <Button size="lg" asChild>
              <Link href="/vouchers/new">
                <Plus />
                سند صرف جديد
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <StatCard label="عدد السندات (حسب الفلتر)" value={f.number(data.total)} />
        <StatCard label="إجمالي المصروف (السندات الفعالة)" value={f.money(data.activeTotal)} accent="red" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'رقم السند، المستفيد، البيان، المرجع...' },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
            { type: 'select', name: 'kind', label: 'نوع الصرف', options: Object.entries(VOUCHER_KIND).map(([k, v]) => ({ value: k, label: v })) },
            { type: 'select', name: 'category', label: 'نوع المصروف', options: categories.map((c) => ({ value: String(c.id), label: c.name })) },
            { type: 'select', name: 'method', label: 'طريقة الدفع', options: Object.entries(PAYMENT_METHOD).map(([k, v]) => ({ value: k, label: v })) },
            { type: 'select', name: 'account', label: 'الصندوق/البنك', options: cashAccounts.map((c) => ({ value: String(c.id), label: c.name })) },
            { type: 'select', name: 'user', label: 'المستخدم', options: users.map((u) => ({ value: String(u.id), label: u.fullName })) },
            { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'CANCELLED', label: 'ملغي' }] },
            { type: 'number', name: 'min', label: 'مبلغ من' },
            { type: 'number', name: 'max', label: 'مبلغ إلى' },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد سندات صرف" description="سجّل مصروفًا أو دفعة من زر «سند صرف جديد»." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>رقم السند</TH>
                  <TH>التاريخ</TH>
                  <TH>المستفيد</TH>
                  <TH>النوع</TH>
                  <TH>البيان</TH>
                  <TH>الطريقة</TH>
                  <TH numeric>المبلغ</TH>
                  <TH>من</TH>
                  <TH>بواسطة</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <TR key={r.id} className={r.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                    <TD>
                      <Link href={`/vouchers/${r.id}`} className="num font-semibold text-brand-700 hover:underline">
                        {r.number}
                      </Link>
                    </TD>
                    <TD>{f.date(r.date)}</TD>
                    <TD>{r.payeeName}</TD>
                    <TD className="text-slate-600">{r.kind === 'EXPENSE' && r.expenseAccount ? r.expenseAccount.name : VOUCHER_KIND[r.kind]}</TD>
                    <TD className="max-w-60 truncate text-slate-600">{r.description ?? '—'}</TD>
                    <TD>
                      {PAYMENT_METHOD[r.paymentMethod]}
                      {r.cheque ? <span className="ms-1"><StatusBadge map={CHEQUE_STATUS} value={r.cheque.status} /></span> : null}
                    </TD>
                    <TD numeric className="font-semibold">
                      {f.money(r.amount)}
                    </TD>
                    <TD className="text-slate-500">{r.cashAccount.name}</TD>
                    <TD className="text-slate-500">{r.createdBy?.fullName}</TD>
                    <TD>
                      <StatusBadge map={DOC_STATUS} value={r.status} />
                    </TD>
                    <TD>
                      <Link href={`/print/vouchers/${r.id}`} target="_blank" className="text-slate-400 hover:text-brand-700" aria-label="طباعة">
                        <Printer className="size-4" />
                      </Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/vouchers" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
