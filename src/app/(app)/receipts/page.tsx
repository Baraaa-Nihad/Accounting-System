import Link from 'next/link'
import { Plus, Printer, FileCheck2 } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { listReceipts } from '@/server/services/receipts'
import { getFormatConfig } from '@/server/settings'
import { db } from '@/server/db'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { DOC_STATUS, PAYMENT_METHOD, RECEIPT_KIND } from '@/lib/labels'
import { firstParam, intParam } from '@/lib/utils'
import { isDateOnly } from '@/lib/dates'

export const metadata = { title: 'سندات القبض' }

export default async function ReceiptsPage({ searchParams }: PageProps<'/receipts'>) {
  const user = await requirePermission('receipts.view')
  const sp = await searchParams
  const [fmt, users, cashAccounts] = await Promise.all([
    getFormatConfig(),
    db.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
    db.cashAccount.findMany({ orderBy: { name: 'asc' } }),
  ])
  const f = makeFormatters(fmt)
  const from = firstParam(sp.from)
  const to = firstParam(sp.to)
  const data = await listReceipts({
    q: firstParam(sp.q),
    from: isDateOnly(from) ? from : undefined,
    to: isDateOnly(to) ? to : undefined,
    method: firstParam(sp.method),
    status: firstParam(sp.status),
    kind: firstParam(sp.kind),
    userId: intParam(sp.user),
    cashAccountId: intParam(sp.account),
    minAmount: firstParam(sp.min),
    maxAmount: firstParam(sp.max),
    page: intParam(sp.page),
  })

  return (
    <>
      <PageHeader
        title="سندات القبض"
        description="كل المبالغ المستلمة: دفعات الطلاب والعائلات، الإيرادات الأخرى، ورأس مال الشركاء. السند الملغي يبقى ظاهرًا بحالة «ملغي»."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/cheques">
                <FileCheck2 />
                الشيكات
              </Link>
            </Button>
            {can(user, 'receipts.create') ? (
              <Button size="lg" asChild>
                <Link href="/receipts/new">
                  <Plus />
                  سند قبض جديد
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <StatCard label="عدد السندات (حسب الفلتر)" value={f.number(data.total)} />
        <StatCard label="إجمالي المقبوض (السندات الفعالة)" value={f.money(data.activeTotal)} accent="green" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'رقم السند، اسم الدافع، اسم الطالب، المرجع...' },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
            { type: 'select', name: 'method', label: 'طريقة الدفع', options: Object.entries(PAYMENT_METHOD).map(([k, v]) => ({ value: k, label: v })) },
            { type: 'select', name: 'kind', label: 'النوع', options: Object.entries(RECEIPT_KIND).map(([k, v]) => ({ value: k, label: v })) },
            { type: 'select', name: 'account', label: 'الصندوق/البنك', options: cashAccounts.map((c) => ({ value: String(c.id), label: c.name })) },
            { type: 'select', name: 'user', label: 'المستخدم', options: users.map((u) => ({ value: String(u.id), label: u.fullName })) },
            { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'CANCELLED', label: 'ملغي' }] },
            { type: 'number', name: 'min', label: 'مبلغ من' },
            { type: 'number', name: 'max', label: 'مبلغ إلى' },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد سندات قبض" description="سجّل دفعة من ملف الطالب أو من زر «سند قبض جديد»." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>رقم السند</TH>
                  <TH>التاريخ</TH>
                  <TH>الدافع</TH>
                  <TH>الطالب / العائلة</TH>
                  <TH>النوع</TH>
                  <TH>الطريقة</TH>
                  <TH numeric>المبلغ</TH>
                  <TH>الحساب</TH>
                  <TH>بواسطة</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((r) => (
                  <TR key={r.id} className={r.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                    <TD>
                      <Link href={`/receipts/${r.id}`} className="num font-semibold text-brand-700 hover:underline">
                        {r.number}
                      </Link>
                    </TD>
                    <TD>{f.date(r.date)}</TD>
                    <TD>{r.payerName}</TD>
                    <TD>
                      {r.student ? (
                        <Link href={`/students/${r.student.id}`} className="hover:text-brand-700">
                          {r.student.fullName}
                        </Link>
                      ) : r.guardian ? (
                        <Link href={`/families/${r.guardian.id}`} className="hover:text-brand-700">
                          عائلة {r.guardian.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="text-slate-600">{RECEIPT_KIND[r.kind]}</TD>
                    <TD>
                      {PAYMENT_METHOD[r.paymentMethod]}
                      {r.cheque ? <Badge tone="amber" className="ms-1">{r.cheque.status === 'IN_PORTFOLIO' ? 'في الحافظة' : r.cheque.status === 'CLEARED' ? 'محصّل' : 'مرتجع'}</Badge> : null}
                    </TD>
                    <TD numeric className="font-semibold">
                      {f.money(r.amount)}
                    </TD>
                    <TD className="text-slate-500">{r.cashAccount?.name ?? (r.paymentMethod === 'CHEQUE' ? 'حافظة الشيكات' : '—')}</TD>
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
        )}
        <Pagination path="/receipts" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
