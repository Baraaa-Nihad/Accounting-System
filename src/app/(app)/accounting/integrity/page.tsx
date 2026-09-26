import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { runIntegrityChecks } from '@/server/services/integrity'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'

export const metadata = { title: 'فحص سلامة البيانات' }

export default async function IntegrityPage() {
  await requirePermission('accounting.view')
  const [fmt, checks] = await Promise.all([getFormatConfig(), runIntegrityChecks(db)])
  const f = makeFormatters(fmt)
  const failed = checks.filter((c) => !c.ok)
  return (
    <>
      <PageHeader
        title="المحاسبة العامة"
        description={`فحص سلامة البيانات: مطابقة المستندات والأرصدة المخزنة مع الدفاتر (${f.dateTimeText(new Date())}). الفحص للقراءة فقط ولا يغيّر أي بيانات.`}
      />
      <AccountingTabs active="integrity" />
      <div className={cn('mb-5 flex items-center gap-3 rounded-2xl border p-4', failed.length ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
        {failed.length ? <XCircle className="size-6 shrink-0" /> : <CheckCircle2 className="size-6 shrink-0" />}
        <p className="font-semibold">
          {failed.length ? `${failed.length} من ${checks.length} فحوص وجدت فروقات — راجع التفاصيل أدناه` : `كل الفحوص سليمة (${checks.length} فحصًا)`}
        </p>
      </div>
      <div className="space-y-3">
        {checks.map((c) => (
          <section key={c.key} className="card overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 px-5 py-4">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />}
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900">{c.title}</h3>
                <p className="text-sm text-slate-500">{c.description}</p>
              </div>
              {c.ok ? <Badge tone="green">سليم</Badge> : <Badge tone="red">{c.count} فرق</Badge>}
            </div>
            {c.issues.length ? (
              <div className="scroll-thin overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2 text-start font-semibold">البند</th>
                      <th className="px-5 py-2 text-start font-semibold">المتوقع (من المستندات)</th>
                      <th className="px-5 py-2 text-start font-semibold">الفعلي (في الدفاتر/المخزن)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.issues.map((i, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-5 py-2">{i.href ? <Link href={i.href} className="text-brand-700 hover:underline">{i.label}</Link> : i.label}</td>
                        <td className="num px-5 py-2">{i.expected ?? '—'}</td>
                        <td className="num px-5 py-2 text-rose-700">{i.actual ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {c.count > c.issues.length ? <p className="px-5 py-2 text-xs text-slate-500">وأكثر... ({c.count} إجمالًا)</p> : null}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </>
  )
}
