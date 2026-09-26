import { requirePermission } from '@/server/auth/guard'
import { getSettings } from '@/server/settings'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import {
  FinanceSettingsForm,
  NumberingSettingsForm,
  PayrollSettingsForm,
  PrintSettingsForm,
  SchoolSettingsForm,
  SecuritySettingsForm,
} from '@/components/settings/settings-forms'
import { firstParam } from '@/lib/utils'

export const metadata = { title: 'الإعدادات' }

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  await requirePermission('settings.manage', 'years.manage', 'backup.manage')
  const sp = await searchParams
  const tab = firstParam(sp.tab) ?? 'school'
  const settings = await getSettings()
  return (
    <>
      <PageHeader title="الإعدادات" description="إعدادات المدرسة والعملة والترقيم والطباعة والأمان." />
      <SettingsLayout active={tab}>
        {tab === 'school' ? <SchoolSettingsForm value={settings.school} /> : null}
        {tab === 'finance' ? <FinanceSettingsForm value={settings.finance} /> : null}
        {tab === 'numbering' ? <NumberingSettingsForm value={settings.numbering} /> : null}
        {tab === 'print' ? <PrintSettingsForm value={settings.print} /> : null}
        {tab === 'payroll' ? <PayrollSettingsForm value={settings.payroll} /> : null}
        {tab === 'security' ? <SecuritySettingsForm value={settings.security} /> : null}
      </SettingsLayout>
    </>
  )
}
