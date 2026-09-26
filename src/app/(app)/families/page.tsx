import Link from 'next/link'
import { Prisma } from '@/generated/prisma/client'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { prepareSearchQuery } from '@/lib/arabic'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { firstParam, intParam } from '@/lib/utils'

export const metadata = { title: 'أولياء الأمور والعائلات' }

export default async function FamiliesPage({ searchParams }: PageProps<'/families'>) {
  await requirePermission('students.view')
  const sp = await searchParams
  const f = makeFormatters(await getFormatConfig())
  const q = firstParam(sp.q)
  const multi = firstParam(sp.multi) === '1'
  const page = intParam(sp.page) ?? 1
  const pageSize = 25
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (q) {
    const { text, digits } = prepareSearchQuery(q)
    conds.push(digits.length >= 3 ? Prisma.sql`(g."searchText" LIKE ${`%${text}%`} OR g."searchText" LIKE ${`%${digits}%`})` : Prisma.sql`g."searchText" LIKE ${`%${text}%`}`)
  }
  const having = multi ? Prisma.sql`HAVING COUNT(DISTINCT s."id") > 1` : Prisma.empty
  const rows = await db.$queryRaw<{ id: number; name: string; phone: string | null; children: bigint; remaining: string }[]>`
    SELECT g."id", g."name", g."phone", COUNT(DISTINCT s."id") AS children,
           COALESCE(SUM(c."netAmount" - c."paidAmount") FILTER (WHERE c."status" = 'ACTIVE'), 0)::text AS remaining
    FROM "guardians" g
    LEFT JOIN "students" s ON s."guardianId" = g."id"
    LEFT JOIN "charges" c ON c."studentId" = s."id"
    WHERE ${Prisma.join(conds, ' AND ')}
    GROUP BY g."id" ${having}
    ORDER BY g."name" ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  const [countRow] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM (
      SELECT g."id" FROM "guardians" g LEFT JOIN "students" s ON s."guardianId" = g."id"
      WHERE ${Prisma.join(conds, ' AND ')} GROUP BY g."id" ${having}
    ) x`
  const total = Number(countRow.count)
  return (
    <>
      <PageHeader
        title="أولياء الأمور والعائلات"
        description="حساب العائلة يجمع كل الأبناء: المطلوب والمدفوع والمتبقي، مع إمكانية تسجيل دفعة واحدة توزع على الأبناء."
        breadcrumbs={[{ label: 'الطلاب', href: '/students' }, { label: 'العائلات' }]}
      />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'search', name: 'q', placeholder: 'اسم ولي الأمر أو الهاتف' },
            { type: 'select', name: 'multi', label: 'عدد الأبناء', options: [{ value: '1', label: 'أكثر من ابن' }] },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState title="لا توجد عائلات" description="تُنشأ العائلات تلقائيًا عند إضافة الطلاب." />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>ولي الأمر</TH>
                  <TH>الهاتف</TH>
                  <TH numeric>عدد الأبناء</TH>
                  <TH numeric>المتبقي على العائلة</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((g) => (
                  <TR key={g.id}>
                    <TD>
                      <Link href={`/families/${g.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                        {g.name}
                      </Link>
                    </TD>
                    <TD>
                      <bdi className="ltr num">{g.phone}</bdi>
                    </TD>
                    <TD numeric>{Number(g.children)}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(g.remaining, { hideZero: true })}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
        <Pagination path="/families" params={sp} page={page} pages={Math.max(1, Math.ceil(total / pageSize))} total={total} pageSize={pageSize} />
      </div>
    </>
  )
}
