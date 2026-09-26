import Link from 'next/link'
import { BookMarked } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listJournal } from '@/server/services/accounting'
import { sourceHref } from '@/server/ledger/statements'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { JOURNAL_SOURCE } from '@/lib/labels'
import { isDateOnly } from '@/lib/dates'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'

export const metadata = { title: 'القيود اليومية' }

export default async function JournalPage({ searchParams }: PageProps<'/accounting/journal'>) {
  const user = await requirePermission('accounting.view')
  const sp = await searchParams
  const status = firstParam(sp.status)
  const [fmt, data, accounts] = await Promise.all([
    getFormatConfig(),
    listJournal(db, {
      q: firstParam(sp.q),
      source: firstParam(sp.source),
      status: status === 'posted' || status === 'reversed' || status === 'reversal' ? status : undefined,
      accountId: intParam(sp.account),
      from: isDateOnly(firstParam(sp.from)) ? firstParam(sp.from) : undefined,
      to: isDateOnly(firstParam(sp.to)) ? firstParam(sp.to) : undefined,
      page: intParam(sp.page),
    }),
    db.account.findMany({ where: { isGroup: false }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
  ])
  const f = makeFormatters(fmt)
  return (
    <>
      <PageHeader
        title="المحاسبة العامة"
        description="القيود الآلية تُنشأ من المستندات وتُلغى بإلغاء مستندها (بقيد عكسي)، والقيود اليدوية للتسويات وتُعكس من صفحتها."
        actions={
          can(user, 'accounting.manage') ? (
            <Link href="/accounting/journal/new" className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-medium text-white hover:bg-brand-700">
              <BookMarked className="size-5" />
              قيد يدوي جديد
            </Link>
          ) : null
        }
      />
      <AccountingTabs active="journal" />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'رقم القيد أو البيان...' },
            {
              type: 'select',
              name: 'source',
              label: 'المصدر',
              options: [{ value: 'MANUAL', label: 'القيود اليدوية' }, { value: 'AUTO', label: 'القيود الآلية' }, ...Object.entries(JOURNAL_SOURCE).filter(([k]) => k !== 'MANUAL' && k !== 'REVERSAL').map(([value, label]) => ({ value, label }))],
            },
            { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'posted', label: 'مرحّل' }, { value: 'reversed', label: 'معكوس' }, { value: 'reversal', label: 'قيد عكسي' }] },
            { type: 'select', name: 'account', label: 'الحساب', options: accounts.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })) },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد قيود بهذه الفلاتر" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>رقم القيد</TH>
                  <TH>التاريخ</TH>
                  <TH>البيان</TH>
                  <TH>المصدر</TH>
                  <TH numeric>المبلغ</TH>
                  <TH>الحالة</TH>
                  <TH>بواسطة</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((e) => {
                  const href = sourceHref(e.sourceType, e.sourceId)
                  return (
                    <TR key={e.id} className={e.status === 'REVERSED' ? 'text-slate-500' : undefined}>
                      <TD>
                        <Link href={`/accounting/journal/${e.id}`} className="num font-medium text-brand-700 hover:underline">
                          {e.number}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">{f.date(e.date)}</TD>
                      <TD className="min-w-72">{e.description}</TD>
                      <TD className="whitespace-nowrap">
                        {href ? (
                          <Link href={href} className="hover:text-brand-700 hover:underline">
                            {JOURNAL_SOURCE[e.sourceType] ?? e.sourceType}
                          </Link>
                        ) : (
                          (JOURNAL_SOURCE[e.sourceType] ?? e.sourceType)
                        )}
                      </TD>
                      <TD numeric>{f.money(e.totalAmount)}</TD>
                      <TD className="whitespace-nowrap">
                        {e.reversalOfId ? <Badge tone="violet">قيد عكسي</Badge> : e.status === 'REVERSED' ? <Badge tone="gray">معكوس</Badge> : <Badge tone="green">مرحّل</Badge>}
                      </TD>
                      <TD className="whitespace-nowrap text-slate-500">{e.createdBy?.fullName ?? 'النظام'}</TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/accounting/journal" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
