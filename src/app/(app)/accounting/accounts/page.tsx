import Link from 'next/link'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { accountTree } from '@/server/services/accounting'
import { getFormatConfig, today as todayOf } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { ACCOUNT_TYPE } from '@/lib/labels'
import { isDateOnly } from '@/lib/dates'
import { cn, firstParam } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'
import { EditAccountDialog, NewAccountDialog } from '@/components/accounting/account-dialogs'

export const metadata = { title: 'دليل الحسابات' }

export default async function AccountsPage({ searchParams }: PageProps<'/accounting/accounts'>) {
  const user = await requirePermission('accounting.view')
  const sp = await searchParams
  const today = await todayOf()
  const asOf = isDateOnly(firstParam(sp.asOf)) ? firstParam(sp.asOf)! : today
  const type = firstParam(sp.type)
  const [fmt, tree] = await Promise.all([getFormatConfig(), accountTree(db, asOf)])
  const f = makeFormatters(fmt)
  const manage = can(user, 'accounting.manage')
  const groups = tree.filter((a) => a.isGroup && a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name, depth: a.depth }))
  const rows = type ? tree.filter((a) => a.type === type) : tree
  return (
    <>
      <PageHeader
        title="المحاسبة العامة"
        description="دليل الحسابات: الحسابات التجميعية تجمع أرصدة فروعها. الحسابات المرتبطة بالصناديق وتصنيفات الذمم والشركاء تُدار من شاشاتها."
        actions={manage ? <NewAccountDialog groups={groups} /> : null}
      />
      <AccountingTabs active="accounts" />
      <div className="card overflow-hidden">
        <FilterBar
          fields={[
            { type: 'select', name: 'type', label: 'النوع', options: Object.entries(ACCOUNT_TYPE).map(([value, label]) => ({ value, label })) },
            { type: 'date', name: 'asOf', label: 'الأرصدة حتى' },
          ]}
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الرمز</TH>
                <TH>الحساب</TH>
                <TH>النوع</TH>
                <TH>مرتبط بـ</TH>
                <TH numeric>الرصيد</TH>
                {manage ? <TH /> : null}
              </tr>
            </THead>
            <tbody>
              {rows.map((a) => (
                <TR key={a.id} className={cn(a.isGroup && 'bg-slate-50/70 font-semibold', !a.isActive && 'opacity-50')}>
                  <TD className="num whitespace-nowrap" style={{ paddingInlineStart: `${1 + a.depth * 1.25}rem` }}>
                    {a.code}
                  </TD>
                  <TD>
                    <Link href={`/accounting/ledger?account=${a.id}`} className="hover:text-brand-700 hover:underline">
                      {a.name}
                    </Link>
                    {!a.isActive ? <Badge className="ms-2">معطل</Badge> : null}
                    {a.isGroup ? <span className="ms-2 text-xs font-normal text-slate-400">تجميعي</span> : null}
                  </TD>
                  <TD className="text-slate-500">{ACCOUNT_TYPE[a.type]}</TD>
                  <TD className="text-xs text-slate-500">{a.linked}</TD>
                  <TD numeric>{f.money(a.balance, { hideZero: true, colored: true })}</TD>
                  {manage ? (
                    <TD className="whitespace-nowrap text-end">
                      {a.isGroup && a.isActive ? <NewAccountDialog groups={groups} defaultParentId={a.id} /> : null}
                      <EditAccountDialog account={{ id: a.id, code: a.code, name: a.name, description: a.description, isActive: a.isActive, isSystem: a.isSystem || !!a.systemKey }} />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </>
  )
}
