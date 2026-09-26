import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSettings } from '@/server/settings'
import { isStatementKind, statementTarget, targetStatement } from '@/server/ledger/party-statements'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { isDateOnly } from '@/lib/dates'
import { firstParam } from '@/lib/utils'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { DocHeader } from '@/components/print/doc-header'

export const metadata = { title: 'طباعة كشف حساب' }

export default async function PrintStatementPage({ params, searchParams }: PageProps<'/print/statement/[kind]/[id]'>) {
  const user = await requireUser()
  const { kind, id } = await params
  const sp = await searchParams
  if (!isStatementKind(kind)) notFound()
  const target = await statementTarget(db, kind, Number(id))
  if (!target) notFound()
  if (!target.permissions.some((x) => user.permissions.has(x))) redirect('/forbidden')
  const from = isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null
  const to = isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null
  const hide = firstParam(sp.hide) === '1'
  const settings = await getSettings()
  const f = makeFormatters({ ...settings.finance })
  const st = await targetStatement(db, target, { from, to, hideReversed: hide })
  const qs = new URLSearchParams(Object.entries({ from, to, hide: hide ? '1' : null }).filter(([, v]) => !!v) as [string, string][]).toString()
  const cell = 'border border-slate-300 px-2 py-1'
  return (
    <>
      <PrintToolbar title={`${target.title}: ${target.name}`} pdfHref={pdfAvailable() ? `/api/pdf/statement/${kind}/${id}${qs ? `?${qs}` : ''}` : null} />
      <div className="mx-auto my-6 max-w-[210mm] bg-white p-8 shadow-lg print:my-0 print:p-0 print:shadow-none">
        <DocHeader
          school={settings.school}
          print={settings.print}
          title={target.title}
          meta={<p className="mt-1 text-sm">{from || to ? `من ${from ? f.dateText(from) : '...'} إلى ${to ? f.dateText(to) : '...'}` : 'كل الفترات'}</p>}
        />
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm print:bg-transparent print:p-0">
          <p>
            الاسم: <b>{target.name}</b>
          </p>
          {target.details.map((d) => (
            <p key={d.label}>
              {d.label}: <span className="num">{d.value}</span>
            </p>
          ))}
        </div>
        <table className="mt-4 w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${cell} text-start`}>التاريخ</th>
              <th className={`${cell} text-start`}>البيان</th>
              <th className={`${cell} text-start`}>المرجع</th>
              <th className={`${cell} text-end`}>{target.debitLabel}</th>
              <th className={`${cell} text-end`}>{target.creditLabel}</th>
              <th className={`${cell} text-end`}>{target.balanceLabel}</th>
            </tr>
          </thead>
          <tbody>
            {from ? (
              <tr className="bg-slate-50">
                <td className={cell}>{f.date(from)}</td>
                <td className={`${cell} font-medium`} colSpan={4}>
                  رصيد افتتاحي
                </td>
                <td className={`${cell} text-end font-semibold`}>{f.money(st.opening)}</td>
              </tr>
            ) : null}
            {st.rows.map((r) => (
              <tr key={r.lineId} className={r.reversed || r.isReversal ? 'text-slate-500' : undefined}>
                <td className={`${cell} whitespace-nowrap`}>{f.date(r.date)}</td>
                <td className={cell}>
                  {r.description}
                  {r.reversed ? ' (أُلغي)' : r.isReversal ? ' (قيد إلغاء)' : ''}
                </td>
                <td className={`${cell} num text-xs`}>{r.entryNumber}</td>
                <td className={`${cell} text-end`}>{f.money(r.debit, { hideZero: true })}</td>
                <td className={`${cell} text-end`}>{f.money(r.credit, { hideZero: true })}</td>
                <td className={`${cell} text-end font-semibold`}>{f.money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td className={cell} colSpan={3}>
                الإجمالي والرصيد الختامي
              </td>
              <td className={`${cell} text-end`}>{f.money(st.totalDebit)}</td>
              <td className={`${cell} text-end`}>{f.money(st.totalCredit)}</td>
              <td className={`${cell} text-end`}>{f.money(st.closing)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-xs text-slate-500">{target.legend}</p>
        <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
          <span>
            استخرجه: {user.fullName} — {f.dateTimeText(new Date())}
          </span>
          <span>{settings.print.footerNote}</span>
        </div>
      </div>
    </>
  )
}
