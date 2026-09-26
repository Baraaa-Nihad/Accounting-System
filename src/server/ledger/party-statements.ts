import 'server-only'
import type { DbOrTx } from '../db'
import type { Permission } from '@/lib/permissions'
import { accountIdByKey } from './accounts'
import { statement, type StatementFilter } from './statements'
import type { DateOnly } from '@/lib/dates'

/**
 * كشوف الحساب الموحدة للأطراف (صندوق/بنك، مورد، مقاول، موظف، حساب محاسبي):
 * نفس المحرك (statement) ونفس الواجهة والطباعة والتصدير.
 */

export const STATEMENT_KINDS = ['cash', 'supplier', 'contractor', 'employee', 'account'] as const
export type StatementKind = (typeof STATEMENT_KINDS)[number]

export function isStatementKind(v: string): v is StatementKind {
  return (STATEMENT_KINDS as readonly string[]).includes(v)
}

export interface StatementTarget {
  kind: StatementKind
  id: number
  title: string
  name: string
  details: { label: string; value: string }[]
  filter: Omit<StatementFilter, 'from' | 'to' | 'hideReversed'>
  sign: 1 | -1
  permission: Permission
  backHref: string
  legend: string
  balanceLabel: string
  debitLabel: string
  creditLabel: string
}

export async function statementTarget(client: DbOrTx, kind: StatementKind, id: number): Promise<StatementTarget | null> {
  switch (kind) {
    case 'cash': {
      const ca = await client.cashAccount.findUnique({ where: { id } })
      if (!ca) return null
      return {
        kind,
        id,
        title: 'كشف حركة الصندوق/البنك',
        name: ca.name,
        details: [
          { label: 'النوع', value: ca.type === 'CASHBOX' ? 'صندوق' : 'حساب بنكي' },
          ...(ca.bankName ? [{ label: 'البنك', value: ca.bankName }] : []),
          ...(ca.accountNumber ? [{ label: 'رقم الحساب', value: ca.accountNumber }] : []),
        ],
        filter: { accountIds: [ca.glAccountId] },
        sign: 1,
        permission: 'treasury.view',
        backHref: '/treasury',
        legend: 'مدين = مبالغ دخلت (مقبوضات وتحويلات واردة) · دائن = مبالغ خرجت (مدفوعات وتحويلات صادرة) · الرصيد = المتوفر',
        balanceLabel: 'الرصيد',
        debitLabel: 'وارد',
        creditLabel: 'صادر',
      }
    }
    case 'supplier': {
      const s = await client.supplier.findUnique({ where: { id } })
      if (!s) return null
      return {
        kind,
        id,
        title: 'كشف حساب مورد',
        name: s.name,
        details: [...(s.category ? [{ label: 'التصنيف', value: s.category }] : []), ...(s.phone ? [{ label: 'الهاتف', value: s.phone }] : [])],
        filter: { accountIds: [await accountIdByKey(client, 'AP_SUPPLIERS')], supplierId: s.id },
        sign: -1,
        permission: 'suppliers.view',
        backHref: `/suppliers/${s.id}`,
        legend: 'دائن = فواتير مستحقة للمورد · مدين = دفعات للمورد · الرصيد الموجب = المستحق للمورد',
        balanceLabel: 'المستحق',
        debitLabel: 'مدفوع',
        creditLabel: 'فواتير',
      }
    }
    case 'contractor': {
      const c = await client.contractor.findUnique({ where: { id } })
      if (!c) return null
      return {
        kind,
        id,
        title: 'كشف حساب عامل/مقاول',
        name: c.name,
        details: [...(c.specialty ? [{ label: 'التخصص', value: c.specialty }] : []), ...(c.phone ? [{ label: 'الهاتف', value: c.phone }] : [])],
        filter: { accountIds: [await accountIdByKey(client, 'AP_CONTRACTORS')], contractorId: c.id },
        sign: -1,
        permission: 'contractors.view',
        backHref: `/contractors/${c.id}`,
        legend: 'دائن = قيمة الأعمال المتفق عليها · مدين = الدفعات · الرصيد الموجب = المتبقي له',
        balanceLabel: 'المتبقي له',
        debitLabel: 'مدفوع',
        creditLabel: 'مستحق',
      }
    }
    case 'employee': {
      const e = await client.employee.findUnique({ where: { id } })
      if (!e) return null
      return {
        kind,
        id,
        title: 'كشف حساب موظف',
        name: e.fullName,
        details: [
          { label: 'الرقم الوظيفي', value: e.employeeNumber },
          ...(e.jobTitle ? [{ label: 'الوظيفة', value: e.jobTitle }] : []),
        ],
        filter: {
          accountIds: [await accountIdByKey(client, 'SALARIES_PAYABLE'), await accountIdByKey(client, 'EMPLOYEE_ADVANCES')],
          employeeId: e.id,
        },
        sign: -1,
        permission: 'salaries.view',
        backHref: `/employees/${e.id}`,
        legend: 'دائن = رواتب مستحقة وخصومات السلف · مدين = رواتب مصروفة وسلف مستلمة · الرصيد الموجب = المستحق للموظف، السالب = سلف عليه',
        balanceLabel: 'المستحق',
        debitLabel: 'مدين',
        creditLabel: 'دائن',
      }
    }
    case 'account': {
      const a = await client.account.findUnique({ where: { id } })
      if (!a) return null
      const ids = a.isGroup ? await descendantLeafIds(client, a.id) : [a.id]
      const debitNature = a.type === 'ASSET' || a.type === 'EXPENSE'
      return {
        kind,
        id,
        title: 'دفتر الأستاذ',
        name: `${a.code} — ${a.name}`,
        details: [],
        filter: { accountIds: ids },
        sign: debitNature ? 1 : -1,
        permission: 'accounting.view',
        backHref: '/accounting',
        legend: debitNature ? 'الرصيد = مدين − دائن' : 'الرصيد = دائن − مدين',
        balanceLabel: 'الرصيد',
        debitLabel: 'مدين',
        creditLabel: 'دائن',
      }
    }
  }
}

/** كل الحسابات الفرعية (غير التجميعية) تحت حساب تجميعي. */
export async function descendantLeafIds(client: DbOrTx, rootId: number): Promise<number[]> {
  const rows = await client.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE tree AS (
      SELECT "id", "isGroup" FROM "accounts" WHERE "id" = ${rootId}
      UNION ALL
      SELECT a."id", a."isGroup" FROM "accounts" a JOIN tree t ON a."parentId" = t."id"
    )
    SELECT "id" FROM tree WHERE "isGroup" = false`
  return rows.map((r) => Number(r.id))
}

export async function targetStatement(
  client: DbOrTx,
  target: StatementTarget,
  range: { from?: DateOnly | null; to?: DateOnly | null; hideReversed?: boolean },
) {
  return statement(client, { ...target.filter, from: range.from, to: range.to, hideReversed: range.hideReversed }, target.sign)
}
