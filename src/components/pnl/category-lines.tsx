import Link from 'next/link'
import { sourceHref } from '@/server/ledger/statements'
import type { CategoryLine } from '@/server/services/pnl'
import type { Formatters } from '@/lib/format-jsx'
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { EmptyState } from '@/components/ui/empty-state'

/** قائمة الحركات التفصيلية لتصنيفات المصروفات/الإيرادات مع رابط المستند المصدر. */
export function CategoryLines({
  data,
  f,
  path,
  params,
  emptyText,
}: {
  data: { rows: CategoryLine[]; total: number; sum: string; page: number; pages: number; pageSize: number }
  f: Formatters
  path: string
  params: Record<string, string | string[] | undefined>
  emptyText: string
}) {
  if (data.rows.length === 0) return <EmptyState title="لا توجد حركات" description={emptyText} />
  return (
    <>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التاريخ</TH>
              <TH>التصنيف</TH>
              <TH>البيان</TH>
              <TH>المرجع</TH>
              <TH numeric>المبلغ</TH>
            </tr>
          </THead>
          <tbody>
            {data.rows.map((r) => {
              const href = sourceHref(r.sourceType, r.sourceId)
              return (
                <TR key={r.lineId}>
                  <TD>{f.date(r.date)}</TD>
                  <TD className="whitespace-nowrap text-slate-600">{r.accountName}</TD>
                  <TD>{r.description}</TD>
                  <TD>
                    {href ? (
                      <Link href={href} className="num text-xs text-brand-700 hover:underline">
                        {r.entryNumber}
                      </Link>
                    ) : (
                      <span className="num text-xs text-slate-400">{r.entryNumber}</span>
                    )}
                  </TD>
                  <TD numeric className="font-semibold">
                    {f.money(r.amount, { colored: true })}
                  </TD>
                </TR>
              )
            })}
          </tbody>
          <tfoot>
            <TFootRow>
              <TD colSpan={4}>إجمالي الحركات حسب الفلتر ({f.number(data.total)})</TD>
              <TD numeric>{f.money(data.sum)}</TD>
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>
      <Pagination path={path} params={params} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
    </>
  )
}

/** شريط نسبة مئوية بسيط لجداول التوزيع. */
export function ShareBar({ value, total, tone = 'bg-brand-500' }: { value: string; total: string; tone?: string }) {
  const t = Number(total)
  const pct = t > 0 ? Math.max(0, Math.min(100, (Number(value) / t) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num w-12 text-xs text-slate-500">{pct.toFixed(1)}%</span>
    </div>
  )
}
