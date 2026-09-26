import { notFound } from 'next/navigation'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { statementTarget } from '@/server/ledger/party-statements'
import { cashAccountBalance } from '@/server/ledger/balances'
import { makeFormatters } from '@/lib/format-jsx'
import { isDateOnly } from '@/lib/dates'
import { firstParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { StatementView } from '@/components/ledger/statement-view'
import { TransferDialog } from '@/components/treasury/transfer-dialog'
import { cashAccountsSummary } from '@/server/services/treasury'

export const metadata = { title: 'حركة الصندوق' }

export default async function CashAccountPage({ params, searchParams }: PageProps<'/treasury/[id]'>) {
  const user = await requirePermission('treasury.view')
  const { id } = await params
  const sp = await searchParams
  const account = await db.cashAccount.findUnique({ where: { id: Number(id) } })
  if (!account) notFound()
  const target = (await statementTarget(db, 'cash', account.id))!
  const from = isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : null
  const to = isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : null
  const [fmt, balance, all] = await Promise.all([getFormatConfig(), cashAccountBalance(db, account.id), cashAccountsSummary(db)])
  const f = makeFormatters(fmt)
  const accounts = all.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))
  return (
    <>
      <PageHeader
        title={account.name}
        description={account.type === 'CASHBOX' ? 'صندوق نقدي' : [account.bankName, account.accountNumber, account.iban].filter(Boolean).join(' — ') || 'حساب بنكي'}
        breadcrumbs={[{ label: 'الصندوق والبنوك', href: '/treasury' }, { label: account.name }]}
        actions={can(user, 'treasury.transfer') && account.isActive && accounts.length > 1 ? <TransferDialog accounts={accounts} defaultFromId={account.id} /> : null}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="الرصيد الحالي" value={f.money(balance)} accent="brand" emphasis />
      </div>
      <StatementView target={target} from={from} to={to} hideReversed={firstParam(sp.hide) === '1'} f={f} canExport={can(user, 'reports.export')} />
    </>
  )
}
