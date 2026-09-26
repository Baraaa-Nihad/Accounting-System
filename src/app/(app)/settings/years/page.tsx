import Link from 'next/link'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { NewYearDialog, SetCurrentYearButton } from '@/components/settings/years-client'
import { YEAR_STATUS } from '@/lib/labels'
import { toDateOnly, addDays, parts } from '@/lib/dates'

export const metadata = { title: 'السنوات الدراسية' }

export default async function YearsPage() {
  await requirePermission('years.manage')
  const f = makeFormatters(await getFormatConfig())
  const years = await db.academicYear.findMany({
    orderBy: { startDate: 'desc' },
    include: { _count: { select: { enrollments: true, charges: true, receipts: true } } },
  })
  const last = years[0]
  const nextStart = last ? addDays(toDateOnly(last.endDate), 1) : `${new Date().getFullYear()}-09-01`
  const y = parts(nextStart).y
  const suggestion = { name: `${y}/${y + 1}`, startDate: nextStart, endDate: `${y + 1}-${nextStart.slice(5, 7) === '09' ? '08-31' : '12-31'}` }
  return (
    <>
      <PageHeader
        title="السنوات الدراسية"
        description="كل سنة دراسية هي فترة مالية. عند انتهائها يمكن إغلاقها (تُقفل حركاتها) وترحيل الطلاب للسنة الجديدة."
        actions={<NewYearDialog suggestion={suggestion} />}
      />
      <SettingsLayout active="years">
        <div className="card overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>السنة</TH>
                  <TH>من</TH>
                  <TH>إلى</TH>
                  <TH numeric>الطلاب المسجلون</TH>
                  <TH numeric>الذمم</TH>
                  <TH numeric>سندات القبض</TH>
                  <TH>الحالة</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {years.map((yr) => (
                  <TR key={yr.id}>
                    <TD className="font-semibold">
                      <bdi className="ltr num">{yr.name}</bdi>
                      {yr.isCurrent ? <Badge tone="teal" className="ms-2">الحالية</Badge> : null}
                    </TD>
                    <TD>{f.date(yr.startDate)}</TD>
                    <TD>{f.date(yr.endDate)}</TD>
                    <TD numeric>{yr._count.enrollments}</TD>
                    <TD numeric>{yr._count.charges}</TD>
                    <TD numeric>{yr._count.receipts}</TD>
                    <TD>
                      <StatusBadge map={YEAR_STATUS} value={yr.status} />
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        {!yr.isCurrent && yr.status === 'OPEN' ? <SetCurrentYearButton yearId={yr.id} /> : null}
                        <Link href={`/settings/years/${yr.id}`} className="rounded-lg px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50">
                          {yr.status === 'OPEN' ? 'إغلاق السنة' : 'التفاصيل'}
                        </Link>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
        <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">
          لترحيل الطلاب إلى السنة الجديدة استخدم{' '}
          <Link href="/students/promote" className="font-semibold underline">
            ترحيل الطلاب
          </Link>
          . سجلات السنة القديمة لا تُحذف ولا تتغير.
        </div>
      </SettingsLayout>
    </>
  )
}
