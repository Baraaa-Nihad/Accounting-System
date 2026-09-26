import Link from 'next/link'
import { Download, FileSpreadsheet } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import type { Ctx } from '@/server/context'
import { IMPORT_TYPES, canImport } from '@/server/import/registry'
import { recentSessions } from '@/server/import/service'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { IMPORT_STATUS } from '@/lib/labels'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { ImportSteps } from '@/components/import/import-steps'
import { ImportUploadButton } from '@/components/import/upload-button'

export const metadata = { title: 'استيراد Excel' }

export default async function ImportPage() {
  const user = await requirePermission('import.excel')
  const ctx: Ctx = { userId: user.id, userName: user.fullName, ip: null, userAgent: null, permissions: user.permissions }
  const types = IMPORT_TYPES.map((t, i) => ({ def: t, order: i + 1 })).filter((t) => canImport(user, t.def))
  const [fmt, sessions] = await Promise.all([getFormatConfig(), recentSessions(ctx)])
  const f = makeFormatters(fmt)
  const userIds = [...new Set(sessions.map((s) => s.createdById).filter((x): x is number => !!x))]
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]))
  const labels = new Map(IMPORT_TYPES.map((t) => [t.key, t.label]))
  return (
    <>
      <PageHeader
        title="استيراد البيانات من Excel"
        description="انقل بياناتك من نظام سابق أو من ملفات Excel: نزّل القالب الجاهز، املأه، ارفعه، راجع نتيجة التحقق، ثم أكّد. لا يُحفظ أي شيء قبل التأكيد."
      />
      <ImportSteps current={1} />
      <p className="mb-3 text-sm text-slate-500">
        عند الانتقال من نظام سابق استورد بالترتيب المرقّم: الطلاب والموظفون أولًا، ثم الأرصدة والذمم والأقساط، ثم السندات. يُقبل ملف <bdi className="ltr">.xlsx</bdi> أو <bdi className="ltr">.csv</bdi> حتى 10 ميغابايت و10,000 صف.
      </p>
      {types.length === 0 ? (
        <Card>
          <EmptyState title="لا توجد أنواع متاحة لك" description="الاستيراد يتطلب صلاحية إنشاء نوع البيانات المستوردة (مثل إضافة الطلاب أو الذمم)." />
        </Card>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map(({ def, order }) => (
            <div key={def.key} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <FileSpreadsheet className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                    <span className="num text-xs text-slate-400">{order}</span>
                    {def.label}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">{def.description}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {def.fields
                  .filter((x) => x.required)
                  .map((x) => (
                    <Badge key={x.key} tone="teal">
                      {x.label}
                    </Badge>
                  ))}
                <span className="text-xs leading-6 text-slate-400">+ {def.fields.filter((x) => !x.required).length} اختياري</span>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <a href={`/api/import/template/${def.key}`} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                  <Download className="size-4" />
                  تنزيل القالب
                </a>
                <ImportUploadButton type={def.key} label={def.label} />
              </div>
            </div>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <CardHeader title="عمليات الاستيراد الأخيرة" description="الجلسات غير المؤكدة تُحذف تلقائيًا بعد 24 ساعة." />
        {sessions.length === 0 ? (
          <EmptyState title="لم يتم أي استيراد بعد" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>التاريخ</TH>
                  <TH>النوع</TH>
                  <TH>الملف</TH>
                  <TH>الحالة</TH>
                  <TH numeric>صفوف الملف</TH>
                  <TH numeric>المستورد</TH>
                  <TH numeric>المتجاهل</TH>
                  <TH numeric>الأخطاء</TH>
                  <TH>المستخدم</TH>
                </tr>
              </THead>
              <tbody>
                {sessions.map((s) => (
                  <TR key={s.id}>
                    <TD>{f.dateTime(s.createdAt)}</TD>
                    <TD>
                      <Link href={`/import/${s.id}`} className="font-medium text-brand-700 hover:underline">
                        {labels.get(s.type) ?? s.type}
                      </Link>
                    </TD>
                    <TD className="max-w-60 truncate" title={s.fileName}>
                      <bdi>{s.fileName}</bdi>
                    </TD>
                    <TD>
                      <StatusBadge map={IMPORT_STATUS} value={s.status} />
                    </TD>
                    <TD numeric>{f.number(s.totalRows)}</TD>
                    <TD numeric>{s.status === 'COMPLETED' ? f.number(s.importedRows) : '—'}</TD>
                    <TD numeric>{s.status === 'COMPLETED' ? f.number(s.skippedRows) : '—'}</TD>
                    <TD numeric>{s.status === 'COMPLETED' ? f.number(s.errorRows) : '—'}</TD>
                    <TD>{s.createdById ? users.get(s.createdById) : ''}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}
