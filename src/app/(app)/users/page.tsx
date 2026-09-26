import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listRoles, listUsers } from '@/server/services/users'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { firstParam, intParam } from '@/lib/utils'
import { USER_STATE } from '@/lib/labels'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { AdminTabs } from '@/components/users/admin-tabs'
import { NewUserDialog } from '@/components/users/user-dialog'

export const metadata = { title: 'المستخدمون' }

export default async function UsersPage({ searchParams }: PageProps<'/users'>) {
  const user = await requirePermission('users.manage', 'partners.manage')
  if (!can(user, 'users.manage')) redirect('/partners')
  const sp = await searchParams
  const [fmt, users, roles] = await Promise.all([
    getFormatConfig(),
    listUsers(db, { q: firstParam(sp.q), roleId: intParam(sp.role), state: firstParam(sp.state) }),
    listRoles(db),
  ])
  const f = makeFormatters(fmt)
  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        description="لكل مستخدم دور يحدد صلاحياته، مع إمكانية إضافة أو حجب صلاحيات بعينها له. كل تغيير يُسجل في سجل النشاط."
        actions={<NewUserDialog roles={roles.map((r) => ({ id: r.id, name: r.name, key: r.key, description: r.description, permissions: r.permissions }))} />}
      />
      <AdminTabs active="users" canUsers canPartners={can(user, 'partners.manage')} />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'بحث بالاسم أو اسم المستخدم...' },
            { type: 'select', name: 'role', label: 'الدور', options: roles.map((r) => ({ value: String(r.id), label: r.name })) },
            { type: 'select', name: 'state', label: 'الحالة', options: Object.entries(USER_STATE).map(([value, s]) => ({ value, label: s.label })) },
          ]}
        />
        {users.length === 0 ? (
          <EmptyState title="لا يوجد مستخدمون بهذه الفلاتر" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الاسم</TH>
                  <TH>اسم المستخدم</TH>
                  <TH>الدور</TH>
                  <TH>الحالة</TH>
                  <TH>آخر دخول</TH>
                  <TH numeric>جلسات نشطة</TH>
                </tr>
              </THead>
              <tbody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">
                        {u.fullName}
                      </Link>
                      {u.id === user.id ? <Badge tone="teal" className="ms-2">أنت</Badge> : null}
                      {u.partner ? <Badge tone="violet" className="ms-2">شريك</Badge> : null}
                    </TD>
                    <TD>
                      <bdi className="ltr">{u.username}</bdi>
                    </TD>
                    <TD>
                      {u.role.name}
                      {u.extraPermissions.length || u.revokedPermissions.length ? <span className="ms-1.5 text-xs text-amber-700">(مخصص)</span> : null}
                    </TD>
                    <TD>
                      <StatusBadge map={USER_STATE} value={u.state} />
                    </TD>
                    <TD className="text-slate-600">
                      {u.lastLoginAt ? (
                        <>
                          {f.dateTime(u.lastLoginAt)}
                          {u.lastLoginIp ? <span className="ms-1 text-xs text-slate-400">(<bdi className="ltr">{u.lastLoginIp}</bdi>)</span> : null}
                        </>
                      ) : (
                        <span className="text-slate-400">لم يدخل بعد</span>
                      )}
                    </TD>
                    <TD numeric>{u.activeSessions}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </>
  )
}
