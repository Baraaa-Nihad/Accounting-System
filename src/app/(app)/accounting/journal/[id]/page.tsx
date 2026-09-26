import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { journalEntryDetail } from '@/server/services/accounting'
import { sourceHref } from '@/server/ledger/statements'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { JOURNAL_SOURCE } from '@/lib/labels'
import { D, sum } from '@/lib/money'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from '@/components/ui/table'
import { AttachmentsPanel } from '@/components/attachments/attachments-panel'
import { AuditTrail } from '@/components/audit/audit-trail'
import { ReverseEntryButton } from '@/components/accounting/reverse-entry-button'

export const metadata = { title: 'قيد يومية' }

export default async function JournalEntryPage({ params }: PageProps<'/accounting/journal/[id]'>) {
  const user = await requirePermission('accounting.view')
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const [fmt, e] = await Promise.all([getFormatConfig(), journalEntryDetail(db, id)])
  if (!e) notFound()
  const f = makeFormatters(fmt)
  const href = sourceHref(e.sourceType, e.sourceId)
  const party = (l: (typeof e.lines)[number]) =>
    l.student
      ? { label: l.student.fullName, href: `/students/${l.student.id}` }
      : l.employee
        ? { label: l.employee.fullName, href: `/employees/${l.employee.id}` }
        : l.supplier
          ? { label: l.supplier.name, href: `/suppliers/${l.supplier.id}` }
          : l.contractor
            ? { label: l.contractor.name, href: `/contractors/${l.contractor.id}` }
            : l.partner
              ? { label: l.partner.name, href: `/partners/${l.partner.id}` }
              : null
  const canReverse = e.sourceType === 'MANUAL' && e.status === 'POSTED' && !e.reversalOfId && can(user, 'accounting.manage')
  return (
    <>
      <PageHeader
        title={`قيد ${e.number}`}
        breadcrumbs={[{ label: 'المحاسبة العامة', href: '/accounting' }, { label: 'القيود اليومية', href: '/accounting/journal' }, { label: e.number }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {f.date(e.date)}
            <span className="text-slate-300">·</span>
            {href ? (
              <Link href={href} className="text-brand-700 hover:underline">
                {JOURNAL_SOURCE[e.sourceType] ?? e.sourceType}
              </Link>
            ) : (
              (JOURNAL_SOURCE[e.sourceType] ?? e.sourceType)
            )}
            {e.academicYear ? (
              <>
                <span className="text-slate-300">·</span>
                السنة <bdi className="num">{e.academicYear.name}</bdi>
              </>
            ) : null}
            {e.reversalOfId ? <Badge tone="violet">قيد عكسي</Badge> : e.status === 'REVERSED' ? <Badge tone="gray">معكوس</Badge> : <Badge tone="green">مرحّل</Badge>}
          </span>
        }
        actions={canReverse ? <ReverseEntryButton entryId={e.id} number={e.number} /> : null}
      />
      <div className="card mb-5 space-y-2 p-5 text-sm">
        <p className="text-base text-slate-900">{e.description}</p>
        <p className="text-slate-500">
          أنشأه {e.createdBy?.fullName ?? 'النظام'} في {f.dateTime(e.createdAt)}
        </p>
        {e.reversalOf ? (
          <p className="text-slate-600">
            هذا القيد يعكس القيد{' '}
            <Link href={`/accounting/journal/${e.reversalOf.id}`} className="num font-medium text-brand-700 hover:underline">
              {e.reversalOf.number}
            </Link>
          </p>
        ) : null}
        {e.reversedBy ? (
          <p className="text-slate-600">
            عُكس بالقيد{' '}
            <Link href={`/accounting/journal/${e.reversedBy.id}`} className="num font-medium text-brand-700 hover:underline">
              {e.reversedBy.number}
            </Link>{' '}
            بتاريخ {f.date(e.reversedBy.date)}
          </p>
        ) : null}
      </div>
      <div className="card mb-5 overflow-hidden">
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الحساب</TH>
                <TH>الطرف</TH>
                <TH>البيان</TH>
                <TH numeric>مدين</TH>
                <TH numeric>دائن</TH>
              </tr>
            </THead>
            <tbody>
              {e.lines.map((l) => {
                const p = party(l)
                return (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/accounting/ledger?account=${l.account.id}`} className="hover:text-brand-700 hover:underline">
                        <span className="num text-slate-500">{l.account.code}</span> {l.account.name}
                      </Link>
                    </TD>
                    <TD>{p ? <Link href={p.href} className="text-brand-700 hover:underline">{p.label}</Link> : <span className="text-slate-300">—</span>}</TD>
                    <TD className="text-slate-600">{l.description}</TD>
                    <TD numeric>{f.money(l.debit, { hideZero: true })}</TD>
                    <TD numeric>{f.money(l.credit, { hideZero: true })}</TD>
                  </TR>
                )
              })}
            </tbody>
            <tfoot>
              <TFootRow>
                <TD>الإجمالي</TD>
                <TD />
                <TD />
                <TD numeric>{f.money(sum(e.lines.map((l) => D(l.debit))))}</TD>
                <TD numeric>{f.money(sum(e.lines.map((l) => D(l.credit))))}</TD>
              </TFootRow>
            </tfoot>
          </Table>
        </TableWrap>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <AttachmentsPanel entityType="JournalEntry" entityId={e.id} canUpload={can(user, 'accounting.manage')} />
        {can(user, 'audit.view') ? <AuditTrail entityType="JournalEntry" entityId={e.id} /> : null}
      </div>
    </>
  )
}
