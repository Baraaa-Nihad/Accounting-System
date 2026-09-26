import Link from 'next/link'
import { UserPlus, FileSpreadsheet, ArrowUpRight, Users } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { listStudents } from '@/server/services/students'
import { listGradesWithSections } from '@/server/services/school'
import { getSelectedYear } from '@/server/context-year'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { STUDENT_STATUS } from '@/lib/labels'
import { firstParam, intParam } from '@/lib/utils'
import { db } from '@/server/db'

export const metadata = { title: 'الطلاب' }

export default async function StudentsPage({ searchParams }: PageProps<'/students'>) {
  const user = await requirePermission('students.view')
  const sp = await searchParams
  const [year, grades, fmt] = await Promise.all([getSelectedYear(), listGradesWithSections(db), getFormatConfig()])
  const f = makeFormatters(fmt)
  const gradeId = intParam(sp.grade)
  const scope = firstParam(sp.scope)
  const data = await listStudents({
    q: firstParam(sp.q),
    yearId: year?.id ?? null,
    onlyEnrolled: scope !== 'all',
    gradeId,
    sectionId: intParam(sp.section),
    status: firstParam(sp.status),
    balance: firstParam(sp.balance) as 'owing' | 'overdue' | 'credit' | 'clear' | undefined,
    page: intParam(sp.page),
    sort: (firstParam(sp.sort) as 'name' | 'number' | 'balance' | 'grade' | undefined) ?? 'name',
  })
  const grade = grades.find((g) => g.id === gradeId)

  return (
    <>
      <PageHeader
        title="الطلاب"
        description={`الطلاب المسجلون في السنة ${year?.name ?? ''} مع أرصدتهم المالية. اضغط على اسم الطالب لفتح ملفه وتسجيل الدفعات.`}
        actions={
          <>
            {can(user, 'import.excel') ? (
              <Button variant="secondary" asChild>
                <Link href="/import?type=students">
                  <FileSpreadsheet />
                  استيراد من Excel
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" asChild>
              <Link href="/families">
                <Users />
                العائلات
              </Link>
            </Button>
            {can(user, 'students.create') ? (
              <Button size="lg" asChild>
                <Link href="/students/new">
                  <UserPlus />
                  إضافة طالب
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="عدد الطلاب (حسب الفلتر)" value={f.number(data.total)} accent="brand" />
        <StatCard label="المتبقي عليهم" value={f.money(data.totals?.remaining)} accent="amber" hint="الذمم غير المسددة لكل السنوات" />
        <StatCard label="منها متأخر" value={f.money(data.totals?.overdue)} accent="red" href="/students?balance=overdue" />
      </div>

      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'اسم الطالب، الرقم، ولي الأمر، الهاتف...' },
            {
              type: 'select',
              name: 'grade',
              label: 'الصف',
              options: grades.map((g) => ({ value: String(g.id), label: g.name })),
            },
            ...(grade
              ? [
                  {
                    type: 'select' as const,
                    name: 'section',
                    label: 'الشعبة',
                    options: grade.sections.map((s) => ({ value: String(s.id), label: s.name })),
                  },
                ]
              : []),
            {
              type: 'select',
              name: 'status',
              label: 'الحالة',
              options: Object.entries(STUDENT_STATUS).map(([k, v]) => ({ value: k, label: v.label })),
            },
            {
              type: 'select',
              name: 'balance',
              label: 'الوضع المالي',
              options: [
                { value: 'owing', label: 'عليه مبالغ' },
                { value: 'overdue', label: 'متأخر عن الدفع' },
                { value: 'credit', label: 'له رصيد دائن' },
                { value: 'clear', label: 'لا شيء عليه' },
              ],
            },
            {
              type: 'select',
              name: 'sort',
              label: 'الترتيب',
              allLabel: 'حسب الاسم',
              options: [
                { value: 'grade', label: 'حسب الصف' },
                { value: 'number', label: 'حسب الرقم' },
                { value: 'balance', label: 'الأكثر مديونية' },
              ],
            },
            {
              type: 'select',
              name: 'scope',
              label: 'النطاق',
              allLabel: 'المسجلون في السنة',
              options: [{ value: 'all', label: 'كل الطلاب (كل السنوات)' }],
            },
          ]}
        />
        {data.rows.length === 0 ? (
          <EmptyState
            title={firstParam(sp.q) || gradeId || firstParam(sp.status) || firstParam(sp.balance) ? 'لا يوجد طلاب مطابقون للبحث' : 'لا يوجد طلاب بعد'}
            description="ابدأ بإضافة طالب، أو استورد قائمة الطلاب من ملف Excel."
            action={
              can(user, 'students.create') ? (
                <Button asChild>
                  <Link href="/students/new">
                    <UserPlus />
                    إضافة طالب
                  </Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>رقم الطالب</TH>
                  <TH>اسم الطالب</TH>
                  <TH>الصف والشعبة</TH>
                  <TH>ولي الأمر</TH>
                  <TH>الهاتف</TH>
                  <TH numeric>المتبقي</TH>
                  <TH numeric>المتأخر</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {data.rows.map((s) => (
                  <TR key={s.id}>
                    <TD className="num text-slate-500">{s.studentNumber}</TD>
                    <TD>
                      <Link href={`/students/${s.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {s.fullName}
                      </Link>
                      {Number(s.credit) > 0 ? <span className="ms-2 text-xs text-emerald-700">رصيد له {f.money(s.credit)}</span> : null}
                    </TD>
                    <TD className="text-slate-600">
                      {s.gradeName ? `${s.gradeName}${s.sectionName ? ` - ${s.sectionName}` : ''}` : <span className="text-slate-400">غير مسجل</span>}
                    </TD>
                    <TD className="text-slate-600">
                      {s.guardianId ? (
                        <Link href={`/families/${s.guardianId}`} className="hover:text-brand-700">
                          {s.guardianName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      <bdi className="ltr num text-slate-600">{s.guardianPhone}</bdi>
                    </TD>
                    <TD numeric className={Number(s.remaining) > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>
                      {f.money(s.remaining, { hideZero: true })}
                    </TD>
                    <TD numeric className="text-rose-600">
                      {f.money(s.overdue, { hideZero: true })}
                    </TD>
                    <TD>
                      <StatusBadge map={STUDENT_STATUS} value={s.status} />
                    </TD>
                    <TD>
                      <Link href={`/students/${s.id}`} className="text-slate-400 hover:text-brand-700" aria-label="فتح الملف">
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/students" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
      </div>
    </>
  )
}
