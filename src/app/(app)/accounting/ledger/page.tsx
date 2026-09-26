import { BookOpen } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { statementTarget } from '@/server/ledger/party-statements'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { isDateOnly } from '@/lib/dates'
import { firstParam, intParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { StatementView } from '@/components/ledger/statement-view'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'

export const metadata = { title: 'دفتر الأستاذ' }

export default async function LedgerPage({ searchParams }: PageProps<'/accounting/ledger'>) {
  const user = await requirePermission('accounting.view')
  const sp = await searchParams
  const accountId = intParam(sp.account)
  const [fmt, accounts, target] = await Promise.all([
    getFormatConfig(),
    db.account.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, isGroup: true } }),
    accountId ? statementTarget(db, 'account', accountId) : Promise.resolve(null),
  ])
  const f = makeFormatters(fmt)
  return (
    <>
      <PageHeader title="المحاسبة العامة" description="دفتر الأستاذ: حركات الحساب مع الرصيد الافتتاحي للفترة والرصيد التراكمي. الحساب التجميعي يعرض حركات كل فروعه." />
      <AccountingTabs active="ledger" />
      <div className="card mb-5 overflow-visible">
        <FilterBar fields={[{ type: 'select', name: 'account', label: 'الحساب', allLabel: 'اختر الحساب', options: accounts.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}${a.isGroup ? ' (تجميعي)' : ''}` })) }]} />
      </div>
      {target ? (
        <>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{target.name}</h2>
          <StatementView
            target={target}
            from={isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null}
            to={isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null}
            hideReversed={firstParam(sp.hide) === '1'}
            f={f}
            canExport={can(user, 'reports.export')}
          />
        </>
      ) : (
        <div className="card">
          <EmptyState icon={<BookOpen />} title="اختر حسابًا لعرض دفتر الأستاذ" description="أو افتحه من دليل الحسابات أو من أي سطر في ميزان المراجعة." />
        </div>
      )}
    </>
  )
}
