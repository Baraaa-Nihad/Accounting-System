import { LinkTabs } from '@/components/ui/link-tabs'

/** تبويبات الإدارة: المستخدمون، الأدوار، الشركاء (حسب الصلاحية). */
export function AdminTabs({ active, canUsers, canPartners }: { active: 'users' | 'roles' | 'partners'; canUsers: boolean; canPartners: boolean }) {
  const tabs = [
    ...(canUsers
      ? [
          { key: 'users', label: 'المستخدمون', href: '/users' },
          { key: 'roles', label: 'الأدوار والصلاحيات', href: '/users/roles' },
        ]
      : []),
    ...(canPartners ? [{ key: 'partners', label: 'الشركاء', href: '/partners' }] : []),
  ]
  return <LinkTabs className="mb-5" active={active} tabs={tabs} />
}
