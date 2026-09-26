import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listLoginAttempts, loginSecuritySummary } from '@/server/services/audit-view'
import { getFormatConfig, getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { describeUserAgent, LOGIN_REASON } from '@/lib/user-agent'
import { isDateOnly } from '@/lib/dates'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { AuditTabs } from '@/components/audit/audit-tabs'
import { UnlockButton } from '@/components/users/user-security'

export const metadata = { title: 'محاولات الدخول' }

export default async function LoginAttemptsPage({ searchParams }: PageProps<'/audit/logins'>) {
  const user = await requirePermission('audit.view')
  const sp = await searchParams
  const settings = await getSettings()
  const result = firstParam(sp.result)
  const [fmt, data, summary] = await Promise.all([
    getFormatConfig(),
    listLoginAttempts(
      db,
      {
        q: firstParam(sp.q),
        result: result === 'ok' || result === 'fail' ? result : undefined,
        from: isDateOnly(firstParam(sp.from)) ? firstParam(sp.from) : undefined,
        to: isDateOnly(firstParam(sp.to)) ? firstParam(sp.to) : undefined,
        page: intParam(sp.page),
      },
      settings.finance.timezone,
    ),
    loginSecuritySummary(db),
  ])
  const f = makeFormatters(fmt)
  const manageUsers = can(user, 'users.manage')
  return (
    <>
      <PageHeader
        title="سجل النشاط"
        description={`كل محاولة دخول ناجحة أو فاشلة مع الجهاز وعنوان IP. يُقفل الحساب تلقائيًا بعد ${settings.security.maxFailedAttempts} محاولات فاشلة متتالية لمدة ${settings.security.lockMinutes} دقيقة.`}
      />
      <AuditTabs active="logins" />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="دخول ناجح (آخر 24 ساعة)" value={f.number(summary.ok24)} accent="green" />
        <StatCard label="محاولات فاشلة (آخر 24 ساعة)" value={f.number(summary.failed24)} accent={summary.failed24 ? 'red' : undefined} />
        <StatCard label="حسابات مقفلة الآن" value={f.number(summary.locked.length)} accent={summary.locked.length ? 'amber' : undefined} />
      </div>
      {summary.locked.length || summary.topIps.length ? (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          {summary.locked.length ? (
            <Card className="overflow-hidden">
              <CardHeader title="حسابات مقفلة" description="تُفتح تلقائيًا بعد انتهاء المدة، أو يدويًا من هنا." />
              <ul className="divide-y divide-slate-100">
                {summary.locked.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      {manageUsers ? (
                        <Link href={`/users/${l.id}`} className="font-medium text-brand-700 hover:underline">
                          {l.fullName}
                        </Link>
                      ) : (
                        l.fullName
                      )}{' '}
                      <span className="text-slate-500">
                        (<bdi className="ltr">{l.username}</bdi>) حتى {f.dateTime(l.lockedUntil)}
                      </span>
                    </span>
                    {manageUsers ? <UnlockButton userId={l.id} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {summary.topIps.length ? (
            <Card className="overflow-hidden">
              <CardHeader title="أكثر الأجهزة محاولات فاشلة (24 ساعة)" />
              <ul className="divide-y divide-slate-100">
                {summary.topIps.map((x) => (
                  <li key={x.ip} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span>
                      <bdi className="ltr font-medium">{x.ip}</bdi> <span className="text-slate-500">— {x.usernames}</span>
                    </span>
                    <Badge tone="red">{x.failures} محاولة</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'اسم المستخدم أو IP...' },
            { type: 'select', name: 'result', label: 'النتيجة', options: [{ value: 'ok', label: 'ناجحة' }, { value: 'fail', label: 'فاشلة' }] },
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا توجد محاولات بهذه الفلاتر" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الوقت</TH>
                  <TH>اسم المستخدم المُدخل</TH>
                  <TH>النتيجة</TH>
                  <TH>IP</TH>
                  <TH>الجهاز</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">{f.dateTime(a.createdAt)}</TD>
                    <TD>
                      {a.userId && manageUsers ? (
                        <Link href={`/users/${a.userId}`} className="text-brand-700 hover:underline">
                          <bdi className="ltr">{a.username}</bdi>
                        </Link>
                      ) : (
                        <bdi className="ltr">{a.username}</bdi>
                      )}
                    </TD>
                    <TD>{a.success ? <Badge tone="green">ناجحة</Badge> : <Badge tone="red">{LOGIN_REASON[a.reason ?? ''] ?? 'فاشلة'}</Badge>}</TD>
                    <TD>
                      <bdi className="ltr">{a.ip ?? '—'}</bdi>
                    </TD>
                    <TD className="text-slate-600">{describeUserAgent(a.userAgent)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/audit/logins" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
