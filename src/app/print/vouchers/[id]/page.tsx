import { notFound } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getVoucher } from '@/server/services/vouchers'
import { getSettings } from '@/server/settings'
import { pdfAvailable } from '@/server/pdf'
import { makeFormatters } from '@/lib/format-jsx'
import { amountToArabicWords } from '@/lib/tafqeet'
import { PAYMENT_METHOD, VOUCHER_KIND } from '@/lib/labels'
import { PrintToolbar } from '@/components/print/print-toolbar'
import { CancelledStamp, DocHeader, Signatures } from '@/components/print/doc-header'

export const metadata = { title: 'طباعة سند صرف' }

export default async function PrintVoucherPage({ params }: PageProps<'/print/vouchers/[id]'>) {
  await requirePermission('vouchers.view')
  const { id } = await params
  const v = await getVoucher(db, Number(id))
  if (!v) notFound()
  const settings = await getSettings()
  const f = makeFormatters({ ...settings.finance })
  const a5 = settings.print.receiptPaper === 'A5'
  const forText =
    v.description ||
    (v.kind === 'EXPENSE' || v.kind === 'OTHER'
      ? v.expenseAccount?.name
      : v.kind === 'CONTRACTOR_PAYMENT'
        ? `دفعة عن ${v.contractorJob?.description ?? 'عمل'}`
        : v.kind === 'SALARY' && v.payrollItem
          ? `راتب شهر ${v.payrollItem.payrollRun.month}/${v.payrollItem.payrollRun.year}`
          : VOUCHER_KIND[v.kind])
  const row = 'flex gap-2 border-b border-dotted border-slate-300 pb-2'
  return (
    <>
      <PrintToolbar title={`سند صرف ${v.number}`} pdfHref={pdfAvailable() ? `/api/pdf/vouchers/${v.id}` : null} />
      <style>{`@page { size: ${a5 ? 'A5 landscape' : 'A4'}; margin: 10mm; }`}</style>
      <div className="mx-auto my-6 max-w-[210mm] bg-white shadow-lg print:my-0 print:shadow-none">
        <div className="relative p-8">
          {v.status === 'CANCELLED' ? <CancelledStamp reason={v.cancelReason} /> : null}
          <DocHeader
            school={settings.school}
            print={settings.print}
            title="سند صرف"
            meta={
              <div className="mt-1 space-y-0.5 text-sm">
                <p>
                  رقم: <b className="num">{v.number}</b>
                </p>
                <p>التاريخ: {f.date(v.date)}</p>
              </div>
            }
          />
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border-2 border-slate-800 px-4 py-3">
            <span className="text-sm text-slate-600">المبلغ</span>
            <span className="text-2xl font-black">{f.money(v.amount, { className: 'text-slate-900' })}</span>
          </div>
          <dl className="mt-5 space-y-3 text-[15px] leading-relaxed">
            <div className={row}>
              <dt className="shrink-0 text-slate-600">اصرفوا للسيد/ة:</dt>
              <dd className="font-semibold">{v.payeeName}</dd>
            </div>
            <div className={row}>
              <dt className="shrink-0 text-slate-600">مبلغًا وقدره:</dt>
              <dd className="font-semibold">{amountToArabicWords(Number(v.amount), settings.finance.currencyCode)}</dd>
            </div>
            <div className={row}>
              <dt className="shrink-0 text-slate-600">وذلك عن:</dt>
              <dd>{forText}</dd>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-dotted border-slate-300 pb-2">
              <span>
                <span className="text-slate-600">نوع الصرف: </span>
                {VOUCHER_KIND[v.kind]}
                {v.kind === 'EXPENSE' && v.expenseAccount ? ` — ${v.expenseAccount.name}` : ''}
              </span>
              <span>
                <span className="text-slate-600">طريقة الدفع: </span>
                {PAYMENT_METHOD[v.paymentMethod]}
              </span>
              <span>
                <span className="text-slate-600">من: </span>
                {v.cashAccount.name}
              </span>
              {v.cheque ? (
                <span>
                  <span className="text-slate-600">شيك رقم: </span>
                  <b className="num">{v.cheque.number}</b> — تاريخ الاستحقاق {f.date(v.cheque.dueDate)}
                </span>
              ) : null}
              {v.referenceNumber ? (
                <span>
                  <span className="text-slate-600">المرجع: </span>
                  <span className="num">{v.referenceNumber}</span>
                </span>
              ) : null}
            </div>
          </dl>
          {v.notes ? <p className="mt-3 text-sm text-slate-600">ملاحظات: {v.notes}</p> : null}
          <Signatures labels={settings.print.voucherSignatures} />
          <div className="mt-8 flex justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            <span>
              أنشأه: {v.createdBy?.fullName ?? '—'} — {f.dateTimeText(v.createdAt)}
            </span>
            <span>{settings.print.footerNote}</span>
          </div>
        </div>
      </div>
    </>
  )
}
