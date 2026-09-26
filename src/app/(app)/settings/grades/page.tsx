import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { listGradesWithSections, listStages } from '@/server/services/school'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { GradeDialog, SectionsEditor, StageDialog } from '@/components/settings/grades-client'

export const metadata = { title: 'الصفوف والشعب' }

export default async function GradesPage() {
  await requirePermission('settings.manage')
  const [grades, stages] = await Promise.all([listGradesWithSections(db), listStages()])
  const gradeOpts = grades.map((g) => ({ id: g.id, name: g.name }))
  const stageOpts = stages.map((s) => ({ id: s.id, name: s.name }))
  return (
    <>
      <PageHeader
        title="المراحل والصفوف والشعب"
        description="«الصف التالي» يُستخدم تلقائيًا عند ترحيل الطلاب للسنة الجديدة."
        actions={
          <>
            <StageDialog />
            <GradeDialog stages={stageOpts} grades={gradeOpts} />
          </>
        }
      />
      <SettingsLayout active="grades">
        <div className="card overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>#</TH>
                  <TH>الصف</TH>
                  <TH>المرحلة</TH>
                  <TH>الشعب</TH>
                  <TH>الصف التالي</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {grades.map((g) => (
                  <TR key={g.id} className={g.isActive ? undefined : 'opacity-50'}>
                    <TD className="num text-slate-400">{g.sortOrder}</TD>
                    <TD className="font-semibold">
                      {g.name}
                      {!g.isActive ? <Badge className="ms-2">معطل</Badge> : null}
                    </TD>
                    <TD className="text-slate-600">{g.stage?.name ?? '—'}</TD>
                    <TD>
                      <SectionsEditor gradeId={g.id} sections={g.sections.map((s) => ({ id: s.id, name: s.name }))} />
                    </TD>
                    <TD className="text-slate-600">{g.nextGrade?.name ?? <span className="text-slate-400">تخرج</span>}</TD>
                    <TD>
                      <GradeDialog
                        stages={stageOpts}
                        grades={gradeOpts}
                        initial={{
                          id: g.id,
                          name: g.name,
                          stageId: g.stageId ? String(g.stageId) : '',
                          sortOrder: String(g.sortOrder),
                          nextGradeId: g.nextGradeId ? String(g.nextGradeId) : '',
                          isActive: g.isActive,
                        }}
                      />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </SettingsLayout>
    </>
  )
}
