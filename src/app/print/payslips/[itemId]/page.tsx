import { notFound, redirect } from 'next/navigation'
import { requireUser, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getPayslip } from '@/server/services/payroll'
import { getSettings } from '@/server/settings'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { amountToArabicWords } from '@/lib/tafqeet'
import { ARABIC_MONTHS } from '@/lib/dates'
import { PAYMENT_METHOD, SALARY_TYPE } from '@/lib/labels'
import { D } from '@/lib/money'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { CancelledStamp, DocHeader, Signatures } from '@/components/print/doc-header'

export const metadata = { title: 'قسيمة راتب' }

export default async function PayslipPage({ params }: PageProps<'/print/payslips/[itemId]'>) {
  const user = await requireUser()
  if (!canSeeSalaries(user)) redirect('/forbidden')
  const { itemId } = await params
  const p = await getPayslip(db, Number(itemId))
  if (!p) notFound()
  const settings = await getSettings()
  const f = makeFormatters({ ...settings.finance })
  const run = p.payrollRun
  const earnings: [string, string, string?][] = [
    ['الراتب الأساسي', p.basicPay.toString(), p.salaryType === 'HOURLY' ? `${p.workHours.toString()} ساعة` : `${p.workDays.toString()} يوم`],
    ['الساعات الإضافية', p.overtimeAmount.toString(), D(p.overtimeHours).isZero() ? undefined : `${p.overtimeHours.toString()} ساعة`],
    ['المكافآت', p.bonuses.toString()],
    ['البدلات', p.allowances.toString()],
  ]
  const deductions: [string, string, string?][] = [
    ['خصم الغياب', p.absenceDeduction.toString(), D(p.absenceDays).isZero() ? undefined : `${p.absenceDays.toString()} يوم`],
    ['خصم التأخير', p.lateDeduction.toString(), D(p.lateHours).isZero() ? undefined : `${p.lateHours.toString()} ساعة`],
    ['خصومات أخرى', p.otherDeductions.toString()],
    ['استقطاعات', p.withholdings.toString()],
    ['قسط السلفة', p.advanceDeduction.toString()],
  ]
  const remaining = D(p.netPay).minus(D(p.paidAmount))
  const cell = 'border border-slate-300 px-3 py-1.5'
  return (
    <>
      <PrintToolbar title={`قسيمة راتب ${p.employee.fullName} — ${run.month}/${run.year}`} pdfHref={pdfAvailable() ? `/api/pdf/payslips/${p.id}` : null} />
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="mx-auto my-6 max-w-[210mm] bg-white shadow-lg print:my-0 print:shadow-none">
        <div className="relative p-8">
          {run.status === 'CANCELLED' ? <CancelledStamp reason={run.cancelReason} /> : null}
          <DocHeader
            school={settings.school}
            print={settings.print}
            title="قسيمة راتب"
            meta={
              <p className="mt-1 text-sm">
                شهر {ARABIC_MONTHS[run.month - 1]} <span className="num">{run.year}</span>
              </p>
            }
          />
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-slate-50 p-3 text-sm print:bg-transparent print:p-0">
            <p>
              الموظف: <b>{p.employee.fullName}</b>
            </p>
            <p>
              الرقم الوظيفي: <b className="num">{p.employee.employeeNumber}</b>
            </p>
            <p>الوظيفة: {p.employee.jobTitle ?? '—'}</p>
            <p>القسم: {p.employee.department ?? '—'}</p>
            <p>
              نوع الراتب: {SALARY_TYPE[p.salaryType]} ({f.money(p.rate)})
            </p>
            <p>
              الحساب البنكي: {[p.employee.bankName, p.employee.iban ?? p.employee.bankAccount].filter(Boolean).join(' — ') || '—'}
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-5">
            {[
              { title: 'الاستحقاقات', rows: earnings, total: p.grossPay.toString(), totalLabel: 'إجمالي الاستحقاقات' },
              { title: 'الاستقطاعات', rows: deductions, total: p.totalDeductions.toString(), totalLabel: 'إجمالي الاستقطاعات' },
            ].map((block) => (
              <table key={block.title} className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className={`${cell} text-start`} colSpan={2}>
                      {block.title}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map(([label, value, note]) => (
                    <tr key={label}>
                      <td className={cell}>
                        {label}
                        {note ? <span className="text-xs text-slate-500"> ({note})</span> : null}
                      </td>
                      <td className={`${cell} text-end`}>{f.money(value, { hideZero: true })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td className={cell}>{block.totalLabel}</td>
                    <td className={`${cell} text-end`}>{f.money(block.total)}</td>
                  </tr>
                </tfoot>
              </table>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border-2 border-slate-800 px-4 py-3">
            <div>
              <p className="text-sm text-slate-600">صافي الراتب</p>
              <p className="text-sm font-semibold">{amountToArabicWords(Number(p.netPay), settings.finance.currencyCode)}</p>
            </div>
            <span className="text-2xl font-black">{f.money(p.netPay, { className: 'text-slate-900' })}</span>
          </div>
          {p.vouchers.length > 0 || remaining.greaterThan(0) ? (
            <div className="mt-4 text-sm">
              <p className="mb-1 font-semibold">الصرف</p>
              {p.vouchers.map((v) => (
                <p key={v.id}>
                  سند <span className="num">{v.number}</span> بتاريخ {f.date(v.date)} — {PAYMENT_METHOD[v.paymentMethod]} — {f.money(v.amount)}
                </p>
              ))}
              {remaining.greaterThan(0) ? <p className="text-amber-700">المتبقي غير المصروف: {f.money(remaining)}</p> : null}
            </div>
          ) : null}
          {p.advanceDeductions.length > 0 ? (
            <p className="mt-3 text-xs text-slate-600">
              السلف:{' '}
              {p.advanceDeductions
                .map((d) => `سلفة ${f.dateText(d.advance.date)} بمبلغ ${f.moneyText(d.advance.amount)} — المتبقي بعد هذا الشهر ${f.moneyText(D(d.advance.amount).minus(D(d.advance.deductedAmount)))}`)
                .join('، ')}
            </p>
          ) : null}
          <Signatures labels={['الموظف', 'المحاسب', 'المدير']} />
          <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            <span>
              استخرجها: {user.fullName} — {f.dateTimeText(new Date())}
            </span>
            <span>{settings.print.footerNote}</span>
          </div>
        </div>
      </div>
    </>
  )
}
