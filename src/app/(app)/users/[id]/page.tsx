import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Info } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listRoles, userState } from '@/server/services/users'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { AUDIT_ACTION, USER_STATE } from '@/lib/labels'
import { isPermission, type Permission } from '@/lib/permissions'
import { describeUserAgent, LOGIN_REASON } from '@/lib/user-agent'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { UserEditForm } from '@/components/users/user-edit-form'
import { EndSessionsButton, ResetPasswordDialog, UnlockButton } from '@/components/users/user-security'

export const metadata = { title: 'مستخدم' }

export default async function UserPage({ params }: PageProps<'/users/[id]'>) {
  const me = await requirePermission('users.manage')
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const now = new Date()
  const [fmt, u, roles, sessions, attempts, activity] = await Promise.all([
    getFormatConfig(),
    db.user.findUnique({ where: { id }, include: { role: true, partner: { select: { id: true, name: true } } } }),
    listRoles(db),
    db.session.findMany({ where: { userId: id, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' } }),
    db.loginAttempt.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 15 }),
    db.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  if (!u) notFound()
  const f = makeFormatters(fmt)
  const state = userState(u, now)
  return (
    <>
      <PageHeader
        title={u.fullName}
        breadcrumbs={[{ label: 'المستخدمون', href: '/users' }, { label: u.fullName }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <bdi className="ltr">{u.username}</bdi>
            <span className="text-slate-300">·</span>
            {u.role.name}
            <StatusBadge map={USER_STATE} value={state} />
            {u.partner ? (
              <Link href={`/partners/${u.partner.id}`}>
                <Badge tone="violet">الشريك {u.partner.name}</Badge>
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            {state === 'locked' ? <UnlockButton userId={u.id} /> : null}
            <ResetPasswordDialog userId={u.id} username={u.username} />
            {sessions.length ? <EndSessionsButton userId={u.id} /> : null}
          </>
        }
      />
      {state === 'locked' ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <Info className="size-4" />
          الحساب مقفل حتى {f.dateTime(u.lockedUntil)} بسبب محاولات دخول فاشلة متكررة.
        </p>
      ) : null}
      {u.mustChangePassword && u.isActive ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <Info className="size-4" />
          سيُطلب من المستخدم تعيين كلمة مرور جديدة عند دخوله القادم.
        </p>
      ) : null}
      <UserEditForm
        isSelf={u.id === me.id}
        roles={roles.map((r) => ({ id: r.id, name: r.name, key: r.key, description: r.description, permissions: r.permissions }))}
        user={{
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          email: u.email ?? '',
          phone: u.phone ?? '',
          roleId: u.roleId,
          extraPermissions: u.extraPermissions.filter(isPermission) as Permission[],
          revokedPermissions: u.revokedPermissions.filter(isPermission) as Permission[],
          isActive: u.isActive,
        }}
      />
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="الجلسات النشطة" description="الأجهزة المسجّل دخولها حاليًا بهذا الحساب." />
          {sessions.length === 0 ? (
            <EmptyState title="لا توجد جلسات نشطة" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>الجهاز</TH>
                    <TH>IP</TH>
                    <TH>بدأت</TH>
                    <TH>آخر نشاط</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {sessions.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        {describeUserAgent(s.userAgent)}
                        {s.id === me.sessionId ? <Badge tone="teal" className="ms-2">هذه الجلسة</Badge> : null}
                      </TD>
                      <TD>
                        <bdi className="ltr">{s.ip ?? '—'}</bdi>
                      </TD>
                      <TD>{f.dateTime(s.createdAt)}</TD>
                      <TD>{f.dateTime(s.lastSeenAt)}</TD>
                      <TD className="text-end">{s.id !== me.sessionId ? <EndSessionsButton userId={u.id} sessionId={s.id} label="إنهاء" /> : null}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="محاولات الدخول الأخيرة" />
          {attempts.length === 0 ? (
            <EmptyState title="لا توجد محاولات دخول" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>الوقت</TH>
                    <TH>النتيجة</TH>
                    <TH>IP</TH>
                    <TH>الجهاز</TH>
                  </tr>
                </THead>
                <tbody>
                  {attempts.map((a) => (
                    <TR key={a.id}>
                      <TD>{f.dateTime(a.createdAt)}</TD>
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
        </Card>
      </div>
      <Card className="mt-5 overflow-hidden">
        <CardHeader
          title="آخر نشاط المستخدم"
          actions={
            can(me, 'audit.view') ? (
              <Link href={`/audit?user=${u.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                السجل الكامل
              </Link>
            ) : null
          }
        />
        {activity.length === 0 ? (
          <EmptyState title="لا يوجد نشاط مسجل" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                <span className="w-36 shrink-0 text-slate-500">{f.dateTime(a.createdAt)}</span>
                <Badge tone="gray">{AUDIT_ACTION[a.action] ?? a.action}</Badge>
                <span className="min-w-0 flex-1 text-slate-700">{a.summary ?? a.entityLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
