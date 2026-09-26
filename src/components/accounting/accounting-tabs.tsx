import { LinkTabs } from '@/components/ui/link-tabs'

export type AccountingTab = 'overview' | 'accounts' | 'journal' | 'ledger' | 'trial' | 'income' | 'balance' | 'integrity'

/** تبويبات المحاسبة العامة. */
export function AccountingTabs({ active }: { active: AccountingTab }) {
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: 'overview', label: 'نظرة عامة', href: '/accounting' },
        { key: 'accounts', label: 'دليل الحسابات', href: '/accounting/accounts' },
        { key: 'journal', label: 'القيود اليومية', href: '/accounting/journal' },
        { key: 'ledger', label: 'دفتر الأستاذ', href: '/accounting/ledger' },
        { key: 'trial', label: 'ميزان المراجعة', href: '/accounting/trial-balance' },
        { key: 'income', label: 'قائمة الدخل', href: '/accounting/income-statement' },
        { key: 'balance', label: 'الميزانية العمومية', href: '/accounting/balance-sheet' },
        { key: 'integrity', label: 'فحص السلامة', href: '/accounting/integrity' },
      ]}
    />
  )
}
