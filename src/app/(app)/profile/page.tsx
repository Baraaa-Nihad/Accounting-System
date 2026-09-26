import { requireUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PERMISSION_GROUPS, PERMISSIONS } from '@/lib/permissions'
import { describeUserAgent, LOGIN_REASON } from '@/lib/user-agent'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { ProfileForm, EndMySessionsButton } from '@/components/users/profile-client'
import { ChangePasswordForm } from '@/app/change-password/form'

export const metadata = { title: 'حسابي' }

export default async function ProfilePage() {
  const me = await requireUser()
  const now = new Date()
  const [fmt, u, sessions, attempts] = await Promise.all([
    getFormatConfig(),
    db.user.findUniqueOrThrow({ where: { id: me.id }, include: { role: true } }),
    db.session.findMany({ where: { userId: me.id, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' } }),
    db.loginAttempt.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])
  const f = makeFormatters(fmt)
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, items: g.permissions.filter((p) => me.permissions.has(p)) })).filter((g) => g.items.length)
  return (
    <>
      <PageHeader
        title="حسابي"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <bdi className="ltr">{u.username}</bdi>
            <span className="text-slate-300">·</span>
            {u.role.name}
            {u.passwordChangedAt ? (
              <>
                <span className="text-slate-300">·</span>
                آخر تغيير لكلمة المرور {f.date(u.passwordChangedAt)}
              </>
            ) : null}
          </span>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="بياناتي" description="تظهر في السندات التي تنشئها وفي سجل النشاط." />
            <CardBody>
              <ProfileForm initial={{ fullName: u.fullName, email: u.email ?? '', phone: u.phone ?? '' }} />
            </CardBody>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader
              title="جلساتي النشطة"
              description="الأجهزة المسجّل دخولها بحسابك. أنهِ أي جلسة لا تعرفها ثم غيّر كلمة المرور."
              actions={sessions.length > 1 ? <EndMySessionsButton label="إنهاء الجلسات الأخرى" /> : null}
            />
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
                        {s.id === me.sessionId ? <Badge tone="teal" className="ms-2">هذا الجهاز</Badge> : null}
                      </TD>
                      <TD>
                        <bdi className="ltr">{s.ip ?? '—'}</bdi>
                      </TD>
                      <TD>{f.dateTime(s.createdAt)}</TD>
                      <TD>{f.dateTime(s.lastSeenAt)}</TD>
                      <TD className="text-end">{s.id !== me.sessionId ? <EndMySessionsButton sessionId={s.id} label="إنهاء" /> : null}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="آخر محاولات الدخول لحسابي" />
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
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="تغيير كلمة المرور" description="تغيير كلمة المرور ينهي جلساتك على الأجهزة الأخرى." />
            <CardBody>
              <ChangePasswordForm redirectTo={null} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="صلاحياتي" description={`${me.permissions.size} صلاحية حسب دور «${u.role.name}»${u.extraPermissions.length || u.revokedPermissions.length ? ' مع تخصيص' : ''}.`} />
            <CardBody className="space-y-3 text-sm">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="mb-1 font-semibold text-slate-700">{g.label}</p>
                  <ul className="list-inside list-disc text-slate-600">
                    {g.items.map((p) => (
                      <li key={p}>{PERMISSIONS[p]}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
