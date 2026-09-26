import type { Permission } from './permissions'

export interface NavItem {
  href: string
  label: string
  icon: string
  permissions: Permission[]
  section?: string
}

/** القائمة الجانبية بالترتيب المطلوب (docs/06-ux-design.md §6.3). */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'الرئيسية', icon: 'home', permissions: ['dashboard.view'] },
  { href: '/students', label: 'الطلاب', icon: 'students', permissions: ['students.view'] },
  { href: '/charges', label: 'الذمم والأقساط', icon: 'charges', permissions: ['charges.view'] },
  { href: '/receipts', label: 'القبض', icon: 'receipts', permissions: ['receipts.view'] },
  { href: '/vouchers', label: 'الصرف', icon: 'vouchers', permissions: ['vouchers.view'] },
  { href: '/employees', label: 'الموظفون والمعلمات', icon: 'employees', permissions: ['employees.view'] },
  { href: '/payroll', label: 'الرواتب', icon: 'payroll', permissions: ['salaries.view', 'payroll.manage'] },
  { href: '/contractors', label: 'العمال والمقاولون', icon: 'contractors', permissions: ['contractors.view'] },
  { href: '/suppliers', label: 'الموردون', icon: 'suppliers', permissions: ['suppliers.view'] },
  { href: '/expenses', label: 'المصروفات', icon: 'expenses', permissions: ['expenses.view'] },
  { href: '/revenues', label: 'الإيرادات', icon: 'revenues', permissions: ['revenues.view'] },
  { href: '/treasury', label: 'الصندوق والبنوك', icon: 'treasury', permissions: ['treasury.view'] },
  { href: '/reports', label: 'التقارير', icon: 'reports', permissions: ['reports.view'] },
  { href: '/import', label: 'استيراد Excel', icon: 'import', permissions: ['import.excel'] },
  { href: '/users', label: 'المستخدمون والصلاحيات', icon: 'users', permissions: ['users.manage', 'partners.manage'] },
  { href: '/settings', label: 'الإعدادات', icon: 'settings', permissions: ['settings.manage', 'years.manage', 'backup.manage'] },
  { href: '/accounting', label: 'المحاسبة العامة', icon: 'accounting', permissions: ['accounting.view'], section: 'متقدم' },
  { href: '/audit', label: 'سجل النشاط', icon: 'audit', permissions: ['audit.view'], section: 'متقدم' },
]
