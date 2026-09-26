import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requirePermission, can, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { departments, listEmployees } from '@/server/services/employees'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { EMPLOYEE_STATUS, SALARY_TYPE } from '@/lib/labels'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'

export const metadata = { title: 'الموظفون والمعلمات' }

export default async function EmployeesPage({ searchParams }: PageProps<'/employees'>) {
  const user = await requirePermission('employees.view')
  const sp = await searchParams
  const salaries = canSeeSalaries(user)
  const [fmt, data, depts, counts] = await Promise.all([
    getFormatConfig(),
    listEmployees(db, { q: firstParam(sp.q), status: firstParam(sp.status) ?? 'ACTIVE', kind: firstParam(sp.kind), department: firstParam(sp.department), page: intParam(sp.page) }),
    departments(db),
    db.employee.groupBy({ by: ['isTeacher'], where: { status: 'ACTIVE' }, _count: true }),
  ])
  const f = makeFormatters(fmt)
  const teachers = counts.find((c) => c.isTeacher)?._count ?? 0
  const staff = counts.find((c) => !c.isTeacher)?._count ?? 0
  return (
    <>
      <PageHeader
        title="الموظفون والمعلمات"
        description="بيانات الموظفين ورواتبهم الأساسية. الرواتب الشهرية تُحتسب من صفحة «الرواتب»."
        actions={
          can(user, 'employees.manage') ? (
            <Button size="lg" asChild>
              <Link href="/employees/new">
                <Plus />
                إضافة موظف
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="الموظفون الفعالون" value={f.number(teachers + staff)} />
        <StatCard label="الهيئة التدريسية" value={f.number(teachers)} accent="violet" />
        <StatCard label="الإداريون والخدمات" value={f.number(staff)} accent="blue" />
      </div>
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'الاسم، الرقم الوظيفي، الهاتف، الوظيفة...' },
            { type: 'select', name: 'kind', label: 'النوع', options: [{ value: 'teacher', label: 'معلمون' }, { value: 'staff', label: 'إداريون وخدمات' }] },
            { type: 'select', name: 'department', label: 'القسم', options: depts.map((d) => ({ value: d, label: d })) },
            { type: 'select', name: 'status', label: 'الحالة', allLabel: 'على رأس العمل', options: [{ value: 'INACTIVE', label: 'غير فعال' }, { value: 'ALL', label: 'الكل' }] },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState title="لا يوجد موظفون" description="أضف الموظفين والمعلمات لاحتساب رواتبهم." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الرقم</TH>
                  <TH>الاسم</TH>
                  <TH>الوظيفة</TH>
                  <TH>القسم</TH>
                  <TH>الهاتف</TH>
                  {salaries ? <TH>نوع الراتب</TH> : null}
                  {salaries ? <TH numeric>الراتب</TH> : null}
                  <TH>الحالة</TH>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((e) => (
                  <TR key={e.id} className={e.status !== 'ACTIVE' ? 'opacity-60' : undefined}>
                    <TD className="num text-slate-500">{e.employeeNumber}</TD>
                    <TD>
                      <Link href={`/employees/${e.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {e.fullName}
                      </Link>
                      {e.isTeacher ? <Badge tone="violet" className="ms-2">معلم</Badge> : null}
                    </TD>
                    <TD className="text-slate-600">{e.jobTitle ?? '—'}</TD>
                    <TD className="text-slate-600">{e.department ?? '—'}</TD>
                    <TD>{e.phone ? <bdi className="ltr num">{e.phone}</bdi> : '—'}</TD>
                    {salaries ? <TD className="text-slate-600">{SALARY_TYPE[e.salaryType]}</TD> : null}
                    {salaries ? (
                      <TD numeric className="font-semibold">
                        {f.money(e.baseSalary)}
                      </TD>
                    ) : null}
                    <TD>
                      <StatusBadge map={EMPLOYEE_STATUS} value={e.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/employees" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
