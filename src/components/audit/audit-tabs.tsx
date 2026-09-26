import { LinkTabs } from '@/components/ui/link-tabs'

export function AuditTabs({ active }: { active: 'log' | 'logins' }) {
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: 'log', label: 'سجل النشاط', href: '/audit' },
        { key: 'logins', label: 'محاولات الدخول', href: '/audit/logins' },
      ]}
    />
  )
}
