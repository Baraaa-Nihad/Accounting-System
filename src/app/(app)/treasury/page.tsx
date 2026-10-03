import Link from 'next/link'
import { AlertTriangle, Banknote, Building2, FileCheck2, List, Landmark, UserRound, Wallet } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { boxAccess, cashAccountsSummary } from '@/server/services/treasury'
import { getSettings, getFormatConfig } from '@/server/settings'
import { accountTotals } from '@/server/ledger/balances'
import { accountIdByKey } from '@/server/ledger/accounts'
import { makeFormatters } from '@/lib/format-jsx'
import { D, sum } from '@/lib/money'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { FilterBar } from '@/components/ui/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { CashAccountDialog } from '@/components/treasury/cash-account-dialog'
import { TransferDialog } from '@/components/treasury/transfer-dialog'

export const metadata = { title: 'الصندوق والبنوك' }

export default async function TreasuryPage({ searchParams }: PageProps<'/treasury'>) {
  const user = await requirePermission('treasury.view')
  const sp = await searchParams
  const from = isDateOnly(firstParam(sp.from)) ? firstParam(sp.from)! : undefined
  const to = isDateOnly(firstParam(sp.to)) ? firstParam(sp.to)! : undefined
  const manage = can(user, 'treasury.manage')
  const [fmt, settings, all, chequesAcc, access, people] = await Promise.all([
    getFormatConfig(),
    getSettings(),
    cashAccountsSummary(db, from || to ? { from, to } : undefined),
    accountIdByKey(db, 'CHEQUES_UNDER_COLLECTION'),
    boxAccess(db, user.id, user.permissions),
    manage
      ? Promise.all([
          db.user.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, username: true } }),
          db.partner.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        ]).then(([users, partners]) => ({
          users: users.map((u) => ({ id: u.id, label: `${u.fullName} (${u.username})` })),
          partners: partners.map((x) => ({ id: x.id, label: x.name })),
        }))
      : { users: [], partners: [] },
  ])
  // صاحب العهدة المقيّد يرى صناديقه والحسابات البنكية فقط
  const accounts = access.restricted ? all.filter((a) => a.type === 'BANK' || access.own.includes(a.id)) : all
  const f = makeFormatters(fmt)
  const cheques = (await accountTotals(db, chequesAcc, to ? { to } : undefined)).net
  const active = accounts.filter((a) => a.isActive)
  const cashTotal = sum(active.filter((a) => a.type === 'CASHBOX').map((a) => a.balance))
  const bankTotal = sum(active.filter((a) => a.type === 'BANK').map((a) => a.balance))
  const transferAccounts = (access.restricted ? all.filter((a) => a.isActive) : active).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))
  const period = !!(from || to)
  // النقدية لدى كل صاحب عهدة (موظف أو شريك)
  const custody = new Map<string, { name: string; kind: 'موظف' | 'شريك'; boxes: number; total: ReturnType<typeof D> }>()
  for (const a of active) {
    if (a.type !== 'CASHBOX' || !(a.custodianName || a.partnerName)) continue
    const key = a.custodianId ? `u${a.custodianId}` : `p${a.partnerId}`
    const row = custody.get(key) ?? { name: (a.custodianName ?? a.partnerName)!, kind: a.custodianId ? 'موظف' : 'شريك', boxes: 0, total: D(0) }
    row.boxes += 1
    row.total = row.total.plus(D(a.balance))
    custody.set(key, row)
  }

  return (
    <>
      <PageHeader
        title="الصندوق والبنوك"
        description="رصيد كل صندوق وحساب بنكي محسوب مباشرة من الحركات المسجلة: المقبوضات والمدفوعات والتحويلات."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/treasury/transfers">
                <List />
                التحويلات
              </Link>
            </Button>
            {manage ? <CashAccountDialog people={people} /> : null}
            {can(user, 'treasury.transfer') && transferAccounts.length > 1 ? (
              <TransferDialog accounts={transferAccounts} fromIds={access.restricted ? access.own : undefined} />
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="النقدية في الصناديق" value={f.money(cashTotal)} icon={<Wallet />} accent="green" emphasis />
        <StatCard label="الأرصدة في البنوك" value={f.money(bankTotal)} icon={<Landmark />} accent="blue" emphasis />
        <StatCard label="إجمالي النقدية المتوفرة" value={f.money(cashTotal.plus(bankTotal))} icon={<Banknote />} accent="brand" emphasis />
        <StatCard label="شيكات برسم التحصيل" value={f.money(cheques)} icon={<FileCheck2 />} accent="amber" href="/cheques" hint="شيكات مستلمة لم تُحصّل بعد" />
      </div>
      {custody.size && !access.restricted ? (
        <div className="card mb-5 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <UserRound className="size-4 text-slate-500" />
            <h2 className="font-semibold text-slate-800">النقدية لدى أصحاب العهدة</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {[...custody.values()]
              .sort((a, b) => b.total.comparedTo(a.total))
              .map((r) => (
                <div key={`${r.kind}-${r.name}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span className="ms-2 text-xs text-slate-500">
                      {r.kind} — {r.boxes === 1 ? 'صندوق واحد' : `${r.boxes} صناديق`}
                    </span>
                  </span>
                  <span className={cn('font-semibold', r.total.isNegative() ? 'text-rose-600' : 'text-slate-900')}>{f.money(r.total)}</span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
      <div className="card mb-5 overflow-hidden">
        <FilterBar
          fields={[
            { type: 'date', name: 'from', label: 'من تاريخ' },
            { type: 'date', name: 'to', label: 'إلى تاريخ' },
          ]}
        />
        <p className="px-4 pb-3 text-xs text-slate-500">
          {period ? 'الأرقام للفترة المحددة؛ «الافتتاحي» هو الرصيد قبل بداية الفترة.' : 'الأرقام منذ بدء استخدام النظام. حدد فترة لعرض حركة شهر أو سنة.'}
        </p>
      </div>
      {accounts.length === 0 ? (
        <EmptyState title="لا توجد صناديق" description="أضف صندوقًا أو حسابًا بنكيًا للبدء." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const bal = D(a.balance)
            const threshold = a.lowBalanceAlert !== null ? D(a.lowBalanceAlert) : a.type === 'CASHBOX' ? D(settings.finance.lowCashThreshold) : null
            const low = a.isActive && threshold !== null && bal.lessThan(threshold)
            return (
              <div key={a.id} className={cn('card flex flex-col overflow-hidden', !a.isActive && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', a.type === 'CASHBOX' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700')}>
                      {a.type === 'CASHBOX' ? <Wallet className="size-5" /> : <Building2 className="size-5" />}
                    </div>
                    <div className="min-w-0">
                      <Link href={`/treasury/${a.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand-700">
                        {a.name}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        {a.type === 'CASHBOX' ? 'صندوق' : [a.bankName, a.accountNumber].filter(Boolean).join(' — ') || 'حساب بنكي'}
                        <span className="num ms-1 text-slate-400">({a.glCode})</span>
                      </p>
                      {a.custodianName || a.partnerName ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-medium text-brand-700">
                          <UserRound className="size-3.5 shrink-0" />
                          {a.custodianName ? `في عهدة ${a.custodianName}` : `صندوق الشريك ${a.partnerName}`}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {a.isDefault ? <Badge tone="teal">افتراضي</Badge> : null}
                    {!a.isActive ? <Badge tone="gray">معطل</Badge> : null}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-sm">
                  <dt className="text-slate-500">{period ? 'الرصيد في بداية الفترة' : 'الرصيد الافتتاحي'}</dt>
                  <dd className="text-end">{f.money(a.opening)}</dd>
                  <dt className="text-slate-500">المقبوضات</dt>
                  <dd className="text-end text-emerald-700">{f.money(a.receipts)}</dd>
                  <dt className="text-slate-500">المدفوعات</dt>
                  <dd className="text-end text-rose-600">{f.money(a.payments)}</dd>
                  <dt className="text-slate-500">تحويلات واردة</dt>
                  <dd className="text-end">{f.money(a.transfersIn)}</dd>
                  <dt className="text-slate-500">تحويلات صادرة</dt>
                  <dd className="text-end">{f.money(a.transfersOut)}</dd>
                </dl>
                <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                  <div>
                    <p className="text-xs text-slate-500">{period && to ? 'الرصيد في نهاية الفترة' : 'الرصيد الحالي'}</p>
                    <p className={cn('text-2xl font-bold', bal.isNegative() ? 'text-rose-600' : 'text-slate-900')}>{f.money(a.balance)}</p>
                    {low ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="size-3.5" />
                        أقل من حد التنبيه ({f.money(threshold!)})
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="soft" size="sm" asChild>
                      <Link href={`/treasury/${a.id}`}>كشف الحركة</Link>
                    </Button>
                    {manage ? (
                      <CashAccountDialog
                        people={people}
                        initial={{
                          id: a.id,
                          name: a.name,
                          type: a.type,
                          bankName: a.bankName ?? '',
                          accountNumber: a.accountNumber ?? '',
                          iban: a.iban ?? '',
                          lowBalanceAlert: a.lowBalanceAlert ?? '',
                          isDefault: a.isDefault,
                          isActive: a.isActive,
                          notes: '',
                          custody: a.custodianId ? `u:${a.custodianId}` : a.partnerId ? `p:${a.partnerId}` : '',
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
