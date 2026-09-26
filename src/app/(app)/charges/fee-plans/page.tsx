import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { chargeTypesList } from '@/server/services/charges'
import { listGradesWithSections } from '@/server/services/school'
import { getSelectedYear } from '@/server/context-year'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { FeePlanDelete, FeePlanDialog } from '@/components/charges/fee-plan-dialog'
import { toDateOnly } from '@/lib/dates'
import { D, sum } from '@/lib/money'

export const metadata = { title: 'الرسوم المقررة' }

export default async function FeePlansPage() {
  await requirePermission('feeplans.manage')
  const [year, grades, types, fmt] = await Promise.all([getSelectedYear(), listGradesWithSections(db), chargeTypesList(), getFormatConfig()])
  const f = makeFormatters(fmt)
  if (!year) return <EmptyState title="لا توجد سنة دراسية" description="أنشئ السنة الدراسية من الإعدادات أولًا." />
  const plans = await db.feePlan.findMany({
    where: { academicYearId: year.id },
    include: { grade: true, chargeType: true },
    orderBy: [{ grade: { sortOrder: 'asc' } }, { chargeType: { sortOrder: 'asc' } }],
  })
  const gradeOpts = grades.map((g) => ({ id: g.id, name: g.name }))
  const typeOpts = types.map((t) => ({ id: t.id, name: t.name }))
  const byGrade = grades
    .map((g) => ({ grade: g, plans: plans.filter((p) => p.gradeId === g.id) }))
    .filter((x) => x.plans.length > 0)
  return (
    <>
      <PageHeader
        title={`الرسوم المقررة — ${year.name}`}
        description="حدد رسوم كل صف مرة واحدة (القسط، التسجيل، الكتب...)، وسيستخدمها النظام تلقائيًا عند إضافة الطلاب والإصدار الجماعي. غيّر السنة من الشريط العلوي."
        breadcrumbs={[{ label: 'الذمم والأقساط', href: '/charges' }, { label: 'الرسوم المقررة' }]}
        actions={<FeePlanDialog yearId={year.id} grades={gradeOpts} chargeTypes={typeOpts} />}
      />
      {byGrade.length === 0 ? (
        <div className="card">
          <EmptyState title="لا توجد رسوم مقررة لهذه السنة" description="أضف رسوم كل صف ليتم تطبيقها تلقائيًا." />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {byGrade.map(({ grade, plans: ps }) => (
            <div key={grade.id} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h3 className="font-semibold text-slate-900">{grade.name}</h3>
                <span className="text-sm text-slate-500">المجموع: {f.money(sum(ps.map((p) => D(p.amount))))}</span>
              </div>
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <TH>نوع الذمة</TH>
                      <TH numeric>المبلغ</TH>
                      <TH>الأقساط</TH>
                      <TH>أول استحقاق</TH>
                      <TH />
                    </tr>
                  </THead>
                  <tbody>
                    {ps.map((p) => (
                      <TR key={p.id}>
                        <TD>{p.chargeType.name}</TD>
                        <TD numeric className="font-semibold">
                          {f.money(p.amount)}
                        </TD>
                        <TD>{p.installmentsCount > 1 ? `${p.installmentsCount} أقساط${p.dueDay ? ` (يوم ${p.dueDay})` : ''}` : 'دفعة واحدة'}</TD>
                        <TD>{p.firstDueDate ? f.date(p.firstDueDate) : '—'}</TD>
                        <TD>
                          <div className="flex">
                            <FeePlanDialog
                              yearId={year.id}
                              grades={gradeOpts}
                              chargeTypes={typeOpts}
                              initial={{
                                id: p.id,
                                gradeId: String(p.gradeId),
                                chargeTypeId: String(p.chargeTypeId),
                                amount: p.amount.toString(),
                                installmentsCount: String(p.installmentsCount),
                                firstDueDate: p.firstDueDate ? toDateOnly(p.firstDueDate) : '',
                                dueDay: p.dueDay ? String(p.dueDay) : '',
                                notes: p.notes ?? '',
                              }}
                            />
                            <FeePlanDelete id={p.id} />
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
