import Link from 'next/link'
import { Printer, FileSpreadsheet } from 'lucide-react'
import { db } from '@/server/db'
import { listYears } from '@/server/years'
import { sourceHref } from '@/server/ledger/statements'
import { targetStatement, type StatementTarget } from '@/server/ledger/party-statements'
import type { Formatters } from '@/lib/format-jsx'
import type { DateOnly } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from '@/components/ui/table'
import { StatementFilters } from '@/components/students/statement-filters'

/** كشف حساب موحد (صندوق، مورد، مقاول، موظف، حساب): فلاتر الفترة، الرصيد التراكمي، الطباعة والتصدير. */
export async function StatementView({
  target,
  from,
  to,
  hideReversed,
  f,
  canExport,
}: {
  target: StatementTarget
  from: DateOnly | null
  to: DateOnly | null
  hideReversed: boolean
  f: Formatters
  canExport: boolean
}) {
  const [st, years] = await Promise.all([targetStatement(db, target, { from, to, hideReversed }), listYears()])
  const yearOptions = years.map((y) => ({ id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate }))
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), ...(hideReversed ? { hide: '1' } : {}) }).toString()
  const base = `${target.kind}/${target.id}`
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
        <StatementFilters years={yearOptions} />
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href={`/print/statement/${base}${qs ? `?${qs}` : ''}`} target="_blank">
              <Printer />
              طباعة / PDF
            </Link>
          </Button>
          {canExport ? (
            <>
              <Button variant="secondary" asChild>
                <a href={`/api/export/statement/${base}?format=xlsx${qs ? `&${qs}` : ''}`}>
                  <FileSpreadsheet />
                  Excel
                </a>
              </Button>
              <Button variant="ghost" asChild>
                <a href={`/api/export/statement/${base}?format=csv${qs ? `&${qs}` : ''}`}>CSV</a>
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <p className="px-4 pt-3 text-xs text-slate-500">{target.legend}</p>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>التاريخ</TH>
              <TH>البيان</TH>
              <TH>المرجع</TH>
              <TH numeric>{target.debitLabel}</TH>
              <TH numeric>{target.creditLabel}</TH>
              <TH numeric>{target.balanceLabel}</TH>
            </tr>
          </THead>
          <tbody>
            {from ? (
              <TR className="bg-slate-50">
                <TD>{f.date(from)}</TD>
                <TD colSpan={4} className="font-medium">
                  رصيد افتتاحي للفترة
                </TD>
                <TD numeric className="font-semibold">
                  {f.money(st.opening)}
                </TD>
              </TR>
            ) : null}
            {st.rows.length === 0 ? (
              <TR>
                <TD colSpan={6} className="py-10 text-center text-slate-500">
                  لا توجد حركات في هذه الفترة
                </TD>
              </TR>
            ) : (
              st.rows.map((r) => {
                const href = sourceHref(r.sourceType, r.sourceId)
                return (
                  <TR key={r.lineId} className={r.reversed || r.isReversal ? 'text-slate-400' : undefined}>
                    <TD>{f.date(r.date)}</TD>
                    <TD>
                      {r.description}
                      {r.reversed ? <Badge tone="gray" className="ms-2">أُلغي لاحقًا</Badge> : null}
                      {r.isReversal ? <Badge tone="gray" className="ms-2">قيد إلغاء</Badge> : null}
                    </TD>
                    <TD>
                      {href ? (
                        <Link href={href} className="num text-xs text-brand-700 hover:underline">
                          {r.entryNumber}
                        </Link>
                      ) : (
                        <span className="num text-xs text-slate-400">{r.entryNumber}</span>
                      )}
                    </TD>
                    <TD numeric>{f.money(r.debit, { hideZero: true })}</TD>
                    <TD numeric>{f.money(r.credit, { hideZero: true })}</TD>
                    <TD numeric className="font-semibold">
                      {f.money(r.balance, { colored: true })}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
          <tfoot>
            <TFootRow>
              <TD colSpan={3}>الإجمالي والرصيد الختامي</TD>
              <TD numeric>{f.money(st.totalDebit)}</TD>
              <TD numeric>{f.money(st.totalCredit)}</TD>
              <TD numeric>{f.money(st.closing)}</TD>
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>
    </div>
  )
}
