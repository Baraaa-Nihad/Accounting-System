import { notFound, redirect } from 'next/navigation'
import { requireUser, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getPayrollRun } from '@/server/services/payroll'
import { getSettings } from '@/server/settings'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { ARABIC_MONTHS } from '@/lib/dates'
import { PAYROLL_STATUS } from '@/lib/labels'
import { sum } from '@/lib/money'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { DocHeader, Signatures } from '@/components/print/doc-header'

export const metadata = { title: 'كشف الرواتب' }

export default async function PrintPayrollPage({ params }: PageProps<'/print/payroll/[id]'>) {
  const user = await requireUser()
  if (!canSeeSalaries(user)) redirect('/forbidden')
  const { id } = await params
  const run = await getPayrollRun(db, Number(id))
  if (!run) notFound()
  const settings = await getSettings()
  const f = makeFormatters({ ...settings.finance })
  const cell = 'border border-slate-300 px-1.5 py-1'
  const cols: { key: 'basicPay' | 'overtimeAmount' | 'bonuses' | 'allowances' | 'grossPay' | 'absenceDeduction' | 'lateDeduction' | 'otherDeductions' | 'withholdings' | 'advanceDeduction' | 'netPay'; label: string }[] = [
    { key: 'basicPay', label: 'الأساسي' },
    { key: 'overtimeAmount', label: 'الإضافي' },
    { key: 'bonuses', label: 'مكافآت' },
    { key: 'allowances', label: 'بدلات' },
    { key: 'grossPay', label: 'الإجمالي' },
    { key: 'absenceDeduction', label: 'غياب' },
    { key: 'lateDeduction', label: 'تأخير' },
    { key: 'otherDeductions', label: 'خصومات' },
    { key: 'withholdings', label: 'استقطاعات' },
    { key: 'advanceDeduction', label: 'سلف' },
    { key: 'netPay', label: 'الصافي' },
  ]
  return (
    <>
      <PrintToolbar title={`كشف رواتب ${run.month}/${run.year}`} pdfHref={pdfAvailable() ? `/api/pdf/payroll/${run.id}` : null} />
      <style>{`@page { size: A4 landscape; margin: 8mm; }`}</style>
      <div className="mx-auto my-6 max-w-[297mm] bg-white p-6 shadow-lg print:my-0 print:p-0 print:shadow-none">
        <DocHeader
          school={settings.school}
          print={settings.print}
          title="كشف الرواتب"
          meta={
            <p className="mt-1 text-sm">
              شهر {ARABIC_MONTHS[run.month - 1]} <span className="num">{run.year}</span> — {PAYROLL_STATUS[run.status].label}
            </p>
          }
        />
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${cell} text-center`}>#</th>
              <th className={`${cell} text-start`}>الموظف</th>
              {cols.map((c) => (
                <th key={c.key} className={`${cell} text-end`}>
                  {c.label}
                </th>
              ))}
              <th className={`${cell} text-center`}>التوقيع</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((it, i) => (
              <tr key={it.id}>
                <td className={`${cell} text-center`}>{i + 1}</td>
                <td className={cell}>
                  {it.employee.fullName}
                  <span className="num text-slate-500"> ({it.employee.employeeNumber})</span>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`${cell} text-end ${c.key === 'netPay' ? 'font-bold' : ''}`}>
                    {f.money(it[c.key], { hideZero: true, symbol: false })}
                  </td>
                ))}
                <td className={`${cell} w-24`} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td className={cell} colSpan={2}>
                الإجمالي ({run.items.length} موظف)
              </td>
              {cols.map((c) => (
                <td key={c.key} className={`${cell} text-end`}>
                  {f.money(sum(run.items.map((it) => it[c.key])), { symbol: false })}
                </td>
              ))}
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
        <Signatures labels={['المحاسب', 'المدير']} />
        <div className="mt-6 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
          <span>
            استخرجه: {user.fullName} — {f.dateTimeText(new Date())}
          </span>
          <span>{settings.print.footerNote}</span>
        </div>
      </div>
    </>
  )
}
