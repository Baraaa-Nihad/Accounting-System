import { notFound } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getReceipt } from '@/server/services/receipts'
import { studentFinancialSummary } from '@/server/services/students'
import { getSettings } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { amountToArabicWords } from '@/lib/tafqeet'
import { PAYMENT_METHOD, RECEIPT_KIND } from '@/lib/labels'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { pdfAvailable } from '@/server/pdf'
import { CancelledStamp, DocHeader, Signatures } from '@/components/print/doc-header'
import { D } from '@/lib/money'
import { cn } from '@/lib/utils'

export const metadata = { title: 'طباعة سند قبض' }

export default async function PrintReceiptPage({ params }: PageProps<'/print/receipts/[id]'>) {
  await requirePermission('receipts.view')
  const { id } = await params
  const receipt = await getReceipt(db, Number(id))
  if (!receipt) notFound()
  const settings = await getSettings()
  const f = makeFormatters({
    currencySymbol: settings.finance.currencySymbol,
    currencyCode: settings.finance.currencyCode,
    decimals: settings.finance.decimals,
    dateFormat: settings.finance.dateFormat,
    timezone: settings.finance.timezone,
  })
  const a5 = settings.print.receiptPaper === 'A5'
  const students = new Map<number, { name: string; number: string }>()
  for (const a of receipt.allocations) students.set(a.studentId, { name: a.student.fullName, number: a.student.studentNumber })
  const balances = await Promise.all(Array.from(students.keys()).map(async (sid) => [sid, await studentFinancialSummary(db, sid)] as const))
  const lines = receipt.allocations.filter((a) => a.refundVoucherId === null)
  const forText =
    receipt.description ||
    (receipt.kind === 'OTHER_REVENUE'
      ? receipt.revenueAccount?.name
      : receipt.kind === 'PARTNER_CAPITAL'
        ? `رأس مال الشريك ${receipt.partner?.name ?? ''}`
        : [...new Set(lines.map((l) => (l.charge ? l.charge.chargeType.name : 'رصيد دائن')))].join('، '))

  return (
    <>
      <PrintToolbar title={`سند قبض ${receipt.number}`} pdfHref={pdfAvailable() ? `/api/pdf/receipts/${receipt.id}` : null} />
      <style>{`@page { size: ${a5 ? 'A5 landscape' : 'A4'}; margin: 10mm; }`}</style>
      <div className={cn('mx-auto my-6 bg-white shadow-lg print:my-0 print:shadow-none', a5 ? 'max-w-[210mm]' : 'max-w-[210mm]')}>
        <div className="relative p-8">
          {receipt.status === 'CANCELLED' ? <CancelledStamp reason={receipt.cancelReason} /> : null}
          <DocHeader
            school={settings.school}
            print={settings.print}
            title="سند قبض"
            meta={
              <div className="mt-1 space-y-0.5 text-sm">
                <p>
                  رقم: <b className="num">{receipt.number}</b>
                </p>
                <p>التاريخ: {f.date(receipt.date)}</p>
              </div>
            }
          />

          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border-2 border-slate-800 px-4 py-3">
            <span className="text-sm text-slate-600">المبلغ</span>
            <span className="text-2xl font-black">{f.money(receipt.amount, { className: 'text-slate-900' })}</span>
          </div>

          <dl className="mt-5 space-y-3 text-[15px] leading-relaxed">
            <div className="flex gap-2 border-b border-dotted border-slate-300 pb-2">
              <dt className="shrink-0 text-slate-600">استلمنا من السيد/ة:</dt>
              <dd className="font-semibold">{receipt.payerName}</dd>
            </div>
            <div className="flex gap-2 border-b border-dotted border-slate-300 pb-2">
              <dt className="shrink-0 text-slate-600">مبلغًا وقدره:</dt>
              <dd className="font-semibold">{amountToArabicWords(Number(receipt.amount), settings.finance.currencyCode)}</dd>
            </div>
            <div className="flex gap-2 border-b border-dotted border-slate-300 pb-2">
              <dt className="shrink-0 text-slate-600">وذلك عن:</dt>
              <dd>{forText}</dd>
            </div>
            {students.size > 0 ? (
              <div className="flex gap-2 border-b border-dotted border-slate-300 pb-2">
                <dt className="shrink-0 text-slate-600">{students.size > 1 ? 'الطلاب:' : 'الطالب:'}</dt>
                <dd>{Array.from(students.values()).map((s) => `${s.name} (${s.number})`).join('، ')}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-dotted border-slate-300 pb-2">
              <span>
                <span className="text-slate-600">طريقة الدفع: </span>
                {PAYMENT_METHOD[receipt.paymentMethod]}
              </span>
              {receipt.cheque ? (
                <span>
                  <span className="text-slate-600">شيك رقم: </span>
                  <b className="num">{receipt.cheque.number}</b>
                  {receipt.cheque.bankName ? ` — ${receipt.cheque.bankName}` : ''} — تاريخ الاستحقاق {f.date(receipt.cheque.dueDate)}
                </span>
              ) : null}
              {receipt.referenceNumber ? (
                <span>
                  <span className="text-slate-600">المرجع: </span>
                  <span className="num">{receipt.referenceNumber}</span>
                </span>
              ) : null}
              {receipt.kind !== 'STUDENT' ? <span className="text-slate-500">({RECEIPT_KIND[receipt.kind]})</span> : null}
            </div>
          </dl>

          {lines.length > 0 ? (
            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100">
                  {students.size > 1 ? <th className="border border-slate-300 px-2 py-1.5 text-start">الطالب</th> : null}
                  <th className="border border-slate-300 px-2 py-1.5 text-start">البيان</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-start">الاستحقاق</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-end">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    {students.size > 1 ? <td className="border border-slate-300 px-2 py-1">{l.student.fullName}</td> : null}
                    <td className="border border-slate-300 px-2 py-1">
                      {l.charge ? (
                        <>
                          {l.charge.chargeType.name}
                          {l.charge.installmentCount > 1 && l.installment ? ` — القسط ${l.installment.number}` : ''}
                          <span className="text-slate-500"> ({l.charge.academicYear.name})</span>
                        </>
                      ) : (
                        'رصيد دائن (دفعة مقدمة)'
                      )}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">{l.installment ? f.date(l.installment.dueDate) : '—'}</td>
                    <td className="border border-slate-300 px-2 py-1 text-end">{f.money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {balances.length > 0 && receipt.status === 'ACTIVE' ? (
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm print:bg-transparent print:px-0">
              {balances.map(([sid, b]) => {
                const bal = D(b.balance)
                return (
                  <span key={sid}>
                    {students.size > 1 ? `${students.get(sid)?.name}: ` : ''}
                    {bal.isNegative() ? 'رصيد دائن للطالب ' : 'المتبقي على الطالب حتى تاريخه '}
                    <b>{f.money(bal.abs())}</b>
                  </span>
                )
              })}
            </div>
          ) : null}

          {receipt.notes ? <p className="mt-3 text-sm text-slate-600">ملاحظات: {receipt.notes}</p> : null}

          <Signatures labels={settings.print.receiptSignatures} />

          <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            <span>أنشأه: {receipt.createdBy?.fullName ?? '—'} — {f.dateTimeText(receipt.createdAt)}</span>
            <span>{settings.print.footerNote}</span>
          </div>
        </div>
      </div>
    </>
  )
}
