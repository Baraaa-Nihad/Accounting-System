/**
 * تعريف الصلاحيات والأدوار الافتراضية — مشترك بين الواجهة والخادم.
 * الوثيقة: docs/04-roles-permissions.md
 */

export const PERMISSIONS = {
  'dashboard.view': 'عرض لوحة التحكم والتنبيهات',

  'students.view': 'عرض الطلاب وملفاتهم وحسابات العائلات',
  'students.create': 'إضافة طالب',
  'students.edit': 'تعديل بيانات طالب وتغيير حالته',
  'students.promote': 'ترحيل الطلاب للسنة الجديدة',
  'families.manage': 'إدارة أولياء الأمور وربط الإخوة',

  'charges.view': 'عرض الذمم والأقساط',
  'charges.create': 'إضافة ذمة (فردية أو جماعية)',
  'charges.edit': 'تعديل ذمة وإعادة جدولة الأقساط',
  'charges.cancel': 'إلغاء ذمة',
  'feeplans.manage': 'إدارة الرسوم المقررة لكل صف',
  'discounts.create': 'إضافة خصم والموافقة عليه',
  'discounts.cancel': 'إلغاء خصم',

  'receipts.view': 'عرض سندات القبض',
  'receipts.create': 'إضافة دفعات وإنشاء سندات القبض',
  'receipts.edit': 'تعديل الدفعات (البيان، إعادة التوزيع)',
  'receipts.cancel': 'إلغاء الدفعات وسندات القبض',
  'cheques.manage': 'تحصيل الشيكات وتسجيل المرتجع',

  'vouchers.view': 'عرض سندات الصرف',
  'vouchers.create': 'إنشاء سند صرف',
  'vouchers.edit': 'تعديل سندات الصرف (البيان والمرفقات)',
  'vouchers.cancel': 'إلغاء سند صرف',

  'expenses.view': 'عرض المصروفات',
  'expenses.manage': 'إدارة تصنيفات المصروفات',
  'revenues.view': 'عرض الإيرادات',
  'revenues.manage': 'إدارة تصنيفات الإيرادات والذمم وأنواع الخصم',

  'employees.view': 'عرض الموظفين والمعلمات',
  'employees.manage': 'إدارة الموظفين والمعلمات',
  'salaries.view': 'الاطلاع على رواتب الموظفين',
  'payroll.manage': 'احتساب رواتب الشهر واعتمادها',
  'payroll.pay': 'صرف الرواتب',
  'overtime.manage': 'تسجيل الساعات الإضافية',
  'advances.manage': 'إدارة السلف',

  'contractors.view': 'عرض العمال والمقاولين',
  'contractors.manage': 'إدارة العمال والمقاولين وأعمالهم',
  'suppliers.view': 'عرض الموردين',
  'suppliers.manage': 'إدارة الموردين وفواتيرهم',

  'treasury.view': 'عرض الصندوق والبنوك',
  'treasury.transfer': 'التحويل بين الصناديق والبنوك',
  'treasury.manage': 'إدارة الصناديق والحسابات البنكية',
  'treasury.all_boxes': 'القبض والصرف من كل الصناديق (لا من صندوق عهدته فقط)',

  'reports.view': 'الاطلاع على التقارير',
  'reports.financial': 'التقارير المالية (الأرباح والخسائر)',
  'reports.export': 'تصدير التقارير (Excel، PDF، CSV)',

  'import.excel': 'استيراد البيانات من Excel',

  'accounting.view': 'عرض المحاسبة العامة (القيود، الأستاذ، الميزانية)',
  'accounting.manage': 'القيود اليدوية وإدارة دليل الحسابات',

  'users.manage': 'إدارة المستخدمين والأدوار والصلاحيات',
  'partners.manage': 'إدارة الشركاء ونسب الملكية',
  'settings.manage': 'إعدادات المدرسة',
  'years.manage': 'السنوات الدراسية وإغلاقها',
  'audit.view': 'عرض سجل النشاط ومحاولات الدخول',
  'backup.manage': 'النسخ الاحتياطي والاستعادة',
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS
}

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'الرئيسية', permissions: ['dashboard.view'] },
  {
    label: 'الطلاب',
    permissions: ['students.view', 'students.create', 'students.edit', 'students.promote', 'families.manage'],
  },
  {
    label: 'الذمم والخصومات',
    permissions: [
      'charges.view',
      'charges.create',
      'charges.edit',
      'charges.cancel',
      'feeplans.manage',
      'discounts.create',
      'discounts.cancel',
    ],
  },
  { label: 'القبض', permissions: ['receipts.view', 'receipts.create', 'receipts.edit', 'receipts.cancel', 'cheques.manage'] },
  { label: 'الصرف', permissions: ['vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.cancel'] },
  { label: 'المصروفات والإيرادات', permissions: ['expenses.view', 'expenses.manage', 'revenues.view', 'revenues.manage'] },
  {
    label: 'الموظفون والرواتب',
    permissions: [
      'employees.view',
      'employees.manage',
      'salaries.view',
      'payroll.manage',
      'payroll.pay',
      'overtime.manage',
      'advances.manage',
    ],
  },
  { label: 'المقاولون والموردون', permissions: ['contractors.view', 'contractors.manage', 'suppliers.view', 'suppliers.manage'] },
  { label: 'الصندوق والبنوك', permissions: ['treasury.view', 'treasury.transfer', 'treasury.manage', 'treasury.all_boxes'] },
  { label: 'التقارير', permissions: ['reports.view', 'reports.financial', 'reports.export', 'import.excel'] },
  { label: 'المحاسبة العامة', permissions: ['accounting.view', 'accounting.manage'] },
  {
    label: 'الإدارة',
    permissions: ['users.manage', 'partners.manage', 'settings.manage', 'years.manage', 'audit.view', 'backup.manage'],
  },
]

const VIEW_ALL: Permission[] = ALL_PERMISSIONS.filter((p) => p.endsWith('.view'))

export interface SystemRoleDef {
  key: string
  name: string
  description: string
  permissions: Permission[]
}

export const ADMIN_ROLE_KEY = 'admin'

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: ADMIN_ROLE_KEY,
    name: 'مدير النظام',
    description: 'كل الصلاحيات دائمًا، ولا يمكن تعديل هذا الدور.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'partner',
    name: 'شريك',
    description: 'اطلاع كامل ورقابة: كل الشاشات والتقارير وسجل النشاط والموافقة على الخصومات.',
    permissions: [
      ...VIEW_ALL,
      'salaries.view',
      'reports.financial',
      'reports.export',
      'discounts.create',
      'discounts.cancel',
    ],
  },
  {
    key: 'accountant',
    name: 'محاسب',
    description: 'كل العمليات المالية اليومية والرواتب والتقارير والاستيراد.',
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        ![
          'users.manage',
          'partners.manage',
          'settings.manage',
          'years.manage',
          'audit.view',
          'backup.manage',
        ].includes(p),
    ),
  },
  {
    key: 'clerk',
    name: 'موظف مالي',
    description: 'تسجيل الطلاب والذمم والدفعات وسندات الصرف دون الإلغاء أو الرواتب.',
    permissions: [
      'dashboard.view',
      'students.view',
      'students.create',
      'students.edit',
      'families.manage',
      'charges.view',
      'charges.create',
      'receipts.view',
      'receipts.create',
      'vouchers.view',
      'vouchers.create',
      'expenses.view',
      'revenues.view',
      'employees.view',
      'contractors.view',
      'contractors.manage',
      'suppliers.view',
      'suppliers.manage',
      'treasury.view',
      'reports.view',
    ],
  },
  {
    key: 'viewer',
    name: 'مستخدم للعرض فقط',
    description: 'يرى الشاشات والتقارير دون أي تعديل، ودون الرواتب.',
    permissions: VIEW_ALL.filter((p) => p !== 'audit.view' && p !== 'accounting.view' && p !== 'salaries.view'),
  },
]

/** الصلاحية الفعلية = (صلاحيات الدور ∪ المضافة) − المحجوبة. مدير النظام يملك الكل دائمًا. */
export function effectivePermissions(input: {
  roleKey?: string | null
  rolePermissions: string[]
  extraPermissions: string[]
  revokedPermissions: string[]
}): Set<Permission> {
  if (input.roleKey === ADMIN_ROLE_KEY) return new Set(ALL_PERMISSIONS)
  const set = new Set<Permission>()
  for (const p of [...input.rolePermissions, ...input.extraPermissions]) if (isPermission(p)) set.add(p)
  for (const p of input.revokedPermissions) if (isPermission(p)) set.delete(p)
  return set
}
