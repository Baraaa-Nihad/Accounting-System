import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import { freePostingAccounts } from '@/server/ledger/accounts'
import { PageHeader } from '@/components/ui/page-header'
import { ManualEntryForm } from '@/components/accounting/manual-entry-form'

export const metadata = { title: 'قيد يدوي جديد' }

export default async function NewManualEntryPage() {
  await requirePermission('accounting.manage')
  const accounts = await freePostingAccounts(db)
  return (
    <>
      <PageHeader
        title="قيد يدوي جديد"
        description="للتسويات المحاسبية: مجموع المدين يجب أن يساوي مجموع الدائن. يُسجل القيد في سجل النشاط ويمكن عكسه لاحقًا."
        breadcrumbs={[{ label: 'المحاسبة العامة', href: '/accounting' }, { label: 'القيود اليومية', href: '/accounting/journal' }, { label: 'قيد جديد' }]}
      />
      <ManualEntryForm accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))} />
    </>
  )
}
