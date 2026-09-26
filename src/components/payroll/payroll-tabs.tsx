import { LinkTabs } from '@/components/ui/link-tabs'

export function PayrollTabs({ active }: { active: 'runs' | 'overtime' | 'advances' }) {
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: 'runs', label: 'مسيرات الرواتب', href: '/payroll' },
        { key: 'overtime', label: 'الساعات الإضافية', href: '/payroll/overtime' },
        { key: 'advances', label: 'السلف', href: '/payroll/advances' },
      ]}
    />
  )
}
