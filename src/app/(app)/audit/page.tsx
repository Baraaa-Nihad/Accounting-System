import Link from 'next/link'
import { FileSpreadsheet, ShieldAlert } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { diffObjects, toAuditJson } from '@/server/audit'
import { auditFilterOptions, isSensitive, listAuditLogs, type AuditFilters } from '@/server/services/audit-view'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { AUDIT_ACTION, ENTITY_LABEL } from '@/lib/labels'
import { entityHref } from '@/lib/entity-links'
import { describeUserAgent } from '@/lib/user-agent'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam, intParam, withParams } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { AuditTabs } from '@/components/audit/audit-tabs'
import { AuditDetails } from '@/components/audit/audit-details'

export const metadata = { title: 'سجل النشاط' }

const HIDDEN_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'searchText', 'createdById', 'passwordHash'])

/** بيانات سطر واحد لعرضها (مقارنة، أو حقول الإنشاء/الحذف). */
function detailsOf(before: unknown, after: unknown) {
  if (before && after) {
    const changes = diffObjects(before, after).filter((c) => !HIDDEN_FIELDS.has(c.field))
    return { changes: changes.map((c) => ({ field: c.field, before: JSON.stringify(c.before ?? null), after: JSON.stringify(c.after ?? null) })), data: [] as { field: string; value: string }[] }
  }
  const one = (toAuditJson(after ?? before) ?? null) as Record<string, unknown> | null
  if (!one || typeof one !== 'object') return { changes: [], data: [] }
  const data = Object.entries(one)
    .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .slice(0, 40)
    .map(([field, v]) => ({ field, value: JSON.stringify(v) }))
  return { changes: [], data }
}

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const user = await requirePermission('audit.view')
  const sp = await searchParams
  const settings = await getSettings()
  const filters: AuditFilters = {
    q: firstParam(sp.q),
    userId: intParam(sp.user),
    action: firstParam(sp.action),
    entityType: firstParam(sp.entity),
    entityId: firstParam(sp.entityId),
    from: isDateOnly(firstParam(sp.from)) ? firstParam(sp.from) : undefined,
    to: isDateOnly(firstParam(sp.to)) ? firstParam(sp.to) : undefined,
    sensitive: firstParam(sp.sensitive) === '1',
    page: intParam(sp.page),
  }
  const [fmt, data, options] = await Promise.all([getFormatConfig(), listAuditLogs(db, filters, settings.finance.timezone), auditFilterOptions(db)])
  const f = makeFormatters(fmt)
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== 'page' && typeof v === 'string') as [string, string][]).toString()
  return (
    <>
      <PageHeader
        title="سجل النشاط"
        description="كل عملية في النظام: من نفذها، ومتى، ومن أي جهاز، وما الذي تغيّر. السجل للقراءة فقط ولا يمكن تعديله أو حذفه."
        actions={
          can(user, 'reports.export') ? (
            <Button variant="secondary" asChild>
              <a href={`/api/audit/export${exportQs ? `?${exportQs}` : ''}`}>
                <FileSpreadsheet />
                تصدير Excel
              </a>
            </Button>
          ) : null
        }
      />
      <AuditTabs active="log" />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'بحث في الوصف أو رقم السند أو IP...' },
            { type: 'select', name: 'user', label: 'المستخدم', options: options.users.map((u) => ({ value: String(u.id), label: u.fullName })) },
            { type: 'select', name: 'action', label: 'العملية', options: options.actions.map((a) => ({ value: a, label: AUDIT_ACTION[a] ?? a })) },
            { type: 'select', name: 'entity', label: 'الكيان', options: options.entities.map((e) => ({ value: e, label: ENTITY_LABEL[e] ?? e })) },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
            { type: 'select', name: 'sensitive', label: 'النوع', allLabel: 'كل العمليات', options: [{ value: '1', label: 'العمليات الحساسة فقط' }] },
          ]}
        />
        {filters.entityId ? (
          <p className="border-t border-slate-100 bg-sky-50 px-4 py-2 text-sm text-sky-800">
            يعرض سجل كيان واحد فقط.{' '}
            <Link href={withParams('/audit', sp, { entityId: null, entity: null, page: null })} className="font-medium underline">
              عرض الكل
            </Link>
          </p>
        ) : null}
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد عمليات بهذه الفلاتر" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الوقت</TH>
                  <TH>المستخدم</TH>
                  <TH>العملية</TH>
                  <TH>الكيان</TH>
                  <TH>الوصف</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((l) => {
                  const sensitive = isSensitive(l)
                  const href = entityHref(l.entityType, l.entityId)
                  const d = detailsOf(l.before, l.after)
                  const meta = [
                    ...(l.ip ? [{ label: 'IP', value: l.ip }] : []),
                    ...(l.userAgent ? [{ label: 'الجهاز', value: describeUserAgent(l.userAgent) }] : []),
                    { label: 'رقم السطر', value: String(l.id) },
                  ]
                  return (
                    <TR key={l.id} className={cn('align-top', sensitive && 'bg-amber-50/40')}>
                      <TD className="whitespace-nowrap text-slate-600">{f.dateTime(l.createdAt)}</TD>
                      <TD className="whitespace-nowrap">
                        {l.userId ? (
                          <Link href={withParams('/audit', sp, { user: l.userId, page: null })} className="hover:text-brand-700 hover:underline">
                            {l.userName ?? '—'}
                          </Link>
                        ) : (
                          <span className="text-slate-500">{l.userName ?? 'النظام'}</span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <Badge tone={l.action === 'forbidden' || l.action === 'login_failed' ? 'red' : sensitive ? 'amber' : l.action === 'create' ? 'green' : 'gray'}>
                          {sensitive ? <ShieldAlert className="size-3" /> : null}
                          {AUDIT_ACTION[l.action] ?? l.action}
                        </Badge>
                      </TD>
                      <TD className="min-w-40">
                        <span className="block text-xs text-slate-500">{ENTITY_LABEL[l.entityType] ?? l.entityType}</span>
                        {href ? (
                          <Link href={href} className="font-medium text-brand-700 hover:underline">
                            {l.entityLabel ?? l.entityId}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-800">{l.entityLabel ?? l.entityId ?? '—'}</span>
                        )}
                      </TD>
                      <TD className="min-w-80">
                        <span className="text-slate-700">{l.summary ?? '—'}</span>
                        <AuditDetails changes={d.changes} data={d.data} dataLabel={l.after ? 'البيانات المسجلة' : 'البيانات قبل العملية'} meta={meta} />
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/audit" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
