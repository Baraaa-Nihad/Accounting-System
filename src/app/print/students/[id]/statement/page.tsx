import { notFound } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSettings } from '@/server/settings'
import { studentStatement } from '@/server/services/student-statement'
import { getStudentProfile } from '@/server/services/students'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { isDateOnly } from '@/lib/dates'
import { firstParam } from '@/lib/utils'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { DocHeader } from '@/components/print/doc-header'

export const metadata = { title: 'كشف حساب طالب' }

export default async function PrintStudentStatement({ params, searchParams }: PageProps<'/print/students/[id]/statement'>) {
  const user = await requirePermission('students.view')
  const { id } = await params
  const sp = await searchParams
  const student = await getStudentProfile(db, Number(id))
  if (!student) notFound()
  const from = isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null
  const to = isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null
  const settings = await getSettings()
  const f = makeFormatters({ ...settings.finance })
  const st = await studentStatement(student.id, { from, to, hideReversed: firstParam(sp.hide) === '1' })
  const enrollment = student.enrollments[0]
  const qs = new URLSearchParams(Object.entries({ from, to, hide: firstParam(sp.hide) }).filter(([, v]) => !!v) as [string, string][]).toString()
  return (
    <>
      <PrintToolbar title={`كشف حساب ${student.fullName}`} pdfHref={pdfAvailable() ? `/api/pdf/students/${student.id}/statement${qs ? `?${qs}` : ''}` : null} />
      <div className="mx-auto my-6 max-w-[210mm] bg-white p-8 shadow-lg print:my-0 print:p-0 print:shadow-none">
        <DocHeader
          school={settings.school}
          print={settings.print}
          title="كشف حساب طالب"
          meta={<p className="mt-1 text-sm">{from || to ? `من ${from ? f.dateText(from) : '...'} إلى ${to ? f.dateText(to) : '...'}` : 'كل الفترات'}</p>}
        />
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm print:bg-transparent print:p-0">
          <p>
            الطالب: <b>{student.fullName}</b>
          </p>
          <p>
            رقم الطالب: <b className="num">{student.studentNumber}</b>
          </p>
          <p>
            الصف: {enrollment ? `${enrollment.grade.name}${enrollment.section ? ` - ${enrollment.section.name}` : ''} (${enrollment.academicYear.name})` : '—'}
          </p>
          <p>
            ولي الأمر: {student.guardian?.name ?? '—'} {student.guardian?.phone ? <bdi className="ltr num">{student.guardian.phone}</bdi> : null}
          </p>
        </div>
        <table className="mt-4 w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1.5 text-start">التاريخ</th>
              <th className="border border-slate-300 px-2 py-1.5 text-start">البيان</th>
              <th className="border border-slate-300 px-2 py-1.5 text-end">مدين</th>
              <th className="border border-slate-300 px-2 py-1.5 text-end">دائن</th>
              <th className="border border-slate-300 px-2 py-1.5 text-end">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {from ? (
              <tr className="bg-slate-50">
                <td className="border border-slate-300 px-2 py-1">{f.date(from)}</td>
                <td className="border border-slate-300 px-2 py-1 font-medium">رصيد افتتاحي</td>
                <td className="border border-slate-300 px-2 py-1" />
                <td className="border border-slate-300 px-2 py-1" />
                <td className="border border-slate-300 px-2 py-1 text-end font-semibold">{f.money(st.opening)}</td>
              </tr>
            ) : null}
            {st.rows.map((r) => (
              <tr key={r.lineId}>
                <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{f.date(r.date)}</td>
                <td className="border border-slate-300 px-2 py-1">{r.description}</td>
                <td className="border border-slate-300 px-2 py-1 text-end">{f.money(r.debit, { hideZero: true })}</td>
                <td className="border border-slate-300 px-2 py-1 text-end">{f.money(r.credit, { hideZero: true })}</td>
                <td className="border border-slate-300 px-2 py-1 text-end font-semibold">{f.money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td className="border border-slate-300 px-2 py-1.5" colSpan={2}>
                الإجمالي والرصيد الختامي
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-end">{f.money(st.totalDebit)}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-end">{f.money(st.totalCredit)}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-end">{f.money(st.closing)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-xs text-slate-500">مدين = مبالغ مطلوبة من الطالب · دائن = مدفوعات وخصومات · الرصيد الموجب = المتبقي على الطالب</p>
        <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
          <span>استخرجه: {user.fullName} — {f.dateTimeText(new Date())}</span>
          <span>{settings.print.footerNote}</span>
        </div>
      </div>
    </>
  )
}
