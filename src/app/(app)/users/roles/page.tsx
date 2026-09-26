import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listRoles } from '@/server/services/users'
import { ADMIN_ROLE_KEY, ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, isPermission, type Permission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { AdminTabs } from '@/components/users/admin-tabs'
import { DeleteRoleButton, RoleDialog } from '@/components/users/role-dialog'

export const metadata = { title: 'الأدوار والصلاحيات' }

export default async function RolesPage() {
  const user = await requirePermission('users.manage')
  const roles = await listRoles(db)
  const value = (r: (typeof roles)[number]) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    permissions: (r.key === ADMIN_ROLE_KEY ? ALL_PERMISSIONS : r.permissions.filter(isPermission)) as Permission[],
  })
  return (
    <>
      <PageHeader
        title="المستخدمون والصلاحيات"
        description="الدور قالب صلاحيات. تعديل صلاحيات دور يسري فورًا على كل مستخدميه، ويمكن تخصيص أي مستخدم بإضافة أو حجب صلاحيات من صفحته."
        actions={<RoleDialog copyFrom={roles.map(value)} />}
      />
      <AdminTabs active="roles" canUsers canPartners={can(user, 'partners.manage')} />
      <div className="card overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-slate-200">
                <th className="min-w-72 px-4 py-3 text-start text-xs font-semibold text-slate-500">الصلاحية</th>
                {roles.map((r) => (
                  <th key={r.id} className="min-w-32 px-3 py-3 text-center align-top">
                    <span className="block font-semibold text-slate-900">{r.name}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      {r._count.users} مستخدم
                    </span>
                    <span className="mt-2 flex items-center justify-center gap-1">
                      {r.key === ADMIN_ROLE_KEY ? (
                        <Badge tone="gray">ثابت</Badge>
                      ) : (
                        <>
                          <RoleDialog initial={value(r)} />
                          {!r.key && !r.isSystem && r._count.users === 0 ? <DeleteRoleButton roleId={r.id} name={r.name} /> : null}
                        </>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <GroupRows key={g.label} label={g.label} permissions={g.permissions} roles={roles.map(value)} colSpan={roles.length + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function GroupRows({ label, permissions, roles, colSpan }: { label: string; permissions: Permission[]; roles: { id: number; permissions: Permission[] }[]; colSpan: number }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={colSpan} className="px-4 py-2 text-xs font-bold text-slate-600">
          {label}
        </td>
      </tr>
      {permissions.map((p) => (
        <tr key={p} className="border-b border-slate-100 hover:bg-slate-50/60">
          <td className="px-4 py-2 text-slate-700">{PERMISSIONS[p]}</td>
          {roles.map((r) => {
            const on = r.permissions.includes(p)
            return (
              <td key={r.id} className="px-3 py-2 text-center">
                <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-sm', on ? 'bg-emerald-50 text-emerald-700' : 'text-slate-300')} aria-label={on ? 'مسموح' : 'غير مسموح'}>
                  {on ? '✓' : '—'}
                </span>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
