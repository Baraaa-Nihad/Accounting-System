import type { AccountType } from '@/generated/prisma/enums'

/**
 * دليل الحسابات الافتراضي (docs/13-accounting.md §13.2).
 * المفاتيح النظامية (systemKey) ثابتة ويستخدمها الكود للوصول للحسابات دون الاعتماد على الرمز أو الاسم.
 */

export const ACC = {
  ASSETS: 'ASSETS',
  CURRENT_ASSETS: 'CURRENT_ASSETS',
  CASH_GROUP: 'CASH_GROUP',
  BANK_GROUP: 'BANK_GROUP',
  AR_STUDENTS: 'AR_STUDENTS',
  CHEQUES_UNDER_COLLECTION: 'CHEQUES_UNDER_COLLECTION',
  EMPLOYEE_ADVANCES: 'EMPLOYEE_ADVANCES',
  OTHER_RECEIVABLES: 'OTHER_RECEIVABLES',
  FIXED_ASSETS: 'FIXED_ASSETS',
  LIABILITIES: 'LIABILITIES',
  CURRENT_LIABILITIES: 'CURRENT_LIABILITIES',
  AP_SUPPLIERS: 'AP_SUPPLIERS',
  AP_CONTRACTORS: 'AP_CONTRACTORS',
  SALARIES_PAYABLE: 'SALARIES_PAYABLE',
  WITHHOLDINGS_PAYABLE: 'WITHHOLDINGS_PAYABLE',
  OTHER_PAYABLES: 'OTHER_PAYABLES',
  EQUITY: 'EQUITY',
  PARTNERS_CAPITAL_GROUP: 'PARTNERS_CAPITAL_GROUP',
  PARTNERS_CURRENT_GROUP: 'PARTNERS_CURRENT_GROUP',
  RETAINED_EARNINGS: 'RETAINED_EARNINGS',
  OPENING_BALANCE: 'OPENING_BALANCE',
  REVENUE: 'REVENUE',
  STUDENT_REVENUE_GROUP: 'STUDENT_REVENUE_GROUP',
  OTHER_REVENUE_GROUP: 'OTHER_REVENUE_GROUP',
  DISCOUNTS_ALLOWED: 'DISCOUNTS_ALLOWED',
  EXPENSES: 'EXPENSES',
  SALARIES_GROUP: 'SALARIES_GROUP',
  SALARIES_EXPENSE: 'SALARIES_EXPENSE',
  OPERATING_EXPENSES_GROUP: 'OPERATING_EXPENSES_GROUP',
} as const

export type SystemAccountKey = (typeof ACC)[keyof typeof ACC]

export interface ChartNode {
  code: string
  name: string
  type: AccountType
  key?: SystemAccountKey
  group?: boolean
  children?: ChartNode[]
}

export const DEFAULT_CHART: ChartNode[] = [
  {
    code: '1',
    name: 'الأصول',
    type: 'ASSET',
    key: ACC.ASSETS,
    group: true,
    children: [
      {
        code: '11',
        name: 'الأصول المتداولة',
        type: 'ASSET',
        key: ACC.CURRENT_ASSETS,
        group: true,
        children: [
          { code: '111', name: 'النقدية في الصناديق', type: 'ASSET', key: ACC.CASH_GROUP, group: true },
          { code: '112', name: 'النقدية في البنوك', type: 'ASSET', key: ACC.BANK_GROUP, group: true },
          { code: '1130', name: 'ذمم الطلاب', type: 'ASSET', key: ACC.AR_STUDENTS },
          { code: '1140', name: 'شيكات برسم التحصيل', type: 'ASSET', key: ACC.CHEQUES_UNDER_COLLECTION },
          { code: '1150', name: 'سلف الموظفين', type: 'ASSET', key: ACC.EMPLOYEE_ADVANCES },
          { code: '1160', name: 'ذمم مدينة أخرى', type: 'ASSET', key: ACC.OTHER_RECEIVABLES },
        ],
      },
      {
        code: '12',
        name: 'الأصول الثابتة',
        type: 'ASSET',
        key: ACC.FIXED_ASSETS,
        group: true,
        children: [
          { code: '1210', name: 'الأثاث والتجهيزات', type: 'ASSET' },
          { code: '1220', name: 'الأجهزة والحواسيب', type: 'ASSET' },
          { code: '1230', name: 'وسائل النقل', type: 'ASSET' },
        ],
      },
    ],
  },
  {
    code: '2',
    name: 'الالتزامات',
    type: 'LIABILITY',
    key: ACC.LIABILITIES,
    group: true,
    children: [
      {
        code: '21',
        name: 'الالتزامات المتداولة',
        type: 'LIABILITY',
        key: ACC.CURRENT_LIABILITIES,
        group: true,
        children: [
          { code: '2110', name: 'ذمم الموردين', type: 'LIABILITY', key: ACC.AP_SUPPLIERS },
          { code: '2120', name: 'ذمم المقاولين والعمال', type: 'LIABILITY', key: ACC.AP_CONTRACTORS },
          { code: '2130', name: 'رواتب مستحقة الدفع', type: 'LIABILITY', key: ACC.SALARIES_PAYABLE },
          { code: '2140', name: 'استقطاعات مستحقة الدفع', type: 'LIABILITY', key: ACC.WITHHOLDINGS_PAYABLE },
          { code: '2150', name: 'أمانات ودائنون آخرون', type: 'LIABILITY', key: ACC.OTHER_PAYABLES },
        ],
      },
    ],
  },
  {
    code: '3',
    name: 'حقوق الملكية',
    type: 'EQUITY',
    key: ACC.EQUITY,
    group: true,
    children: [
      { code: '31', name: 'رأس مال الشركاء', type: 'EQUITY', key: ACC.PARTNERS_CAPITAL_GROUP, group: true },
      { code: '32', name: 'جاري الشركاء', type: 'EQUITY', key: ACC.PARTNERS_CURRENT_GROUP, group: true },
      { code: '3300', name: 'الأرباح المحتجزة', type: 'EQUITY', key: ACC.RETAINED_EARNINGS },
      { code: '3400', name: 'أرصدة افتتاحية', type: 'EQUITY', key: ACC.OPENING_BALANCE },
    ],
  },
  {
    code: '4',
    name: 'الإيرادات',
    type: 'REVENUE',
    key: ACC.REVENUE,
    group: true,
    children: [
      { code: '41', name: 'إيرادات الرسوم الدراسية', type: 'REVENUE', key: ACC.STUDENT_REVENUE_GROUP, group: true },
      {
        code: '42',
        name: 'إيرادات أخرى',
        type: 'REVENUE',
        key: ACC.OTHER_REVENUE_GROUP,
        group: true,
        children: [
          { code: '4201', name: 'التبرعات', type: 'REVENUE' },
          { code: '4202', name: 'إيرادات متنوعة', type: 'REVENUE' },
        ],
      },
      { code: '4900', name: 'الخصومات والإعفاءات الممنوحة', type: 'REVENUE', key: ACC.DISCOUNTS_ALLOWED },
    ],
  },
  {
    code: '5',
    name: 'المصروفات',
    type: 'EXPENSE',
    key: ACC.EXPENSES,
    group: true,
    children: [
      {
        code: '51',
        name: 'الرواتب والأجور',
        type: 'EXPENSE',
        key: ACC.SALARIES_GROUP,
        group: true,
        children: [{ code: '5101', name: 'الرواتب والأجور', type: 'EXPENSE', key: ACC.SALARIES_EXPENSE }],
      },
      {
        code: '52',
        name: 'المصروفات التشغيلية',
        type: 'EXPENSE',
        key: ACC.OPERATING_EXPENSES_GROUP,
        group: true,
        children: [
          'الإيجار',
          'الكهرباء',
          'المياه',
          'الإنترنت والاتصالات',
          'الصيانة',
          'القرطاسية',
          'الكتب',
          'الزي',
          'الطعام',
          'النقل',
          'الوقود',
          'النظافة',
          'أثاث',
          'أجهزة',
          'تسويق',
          'مصاريف إدارية',
          'مصاريف أخرى',
        ].map((name, i) => ({ code: `52${String(i + 1).padStart(2, '0')}`, name, type: 'EXPENSE' as AccountType })),
      },
    ],
  },
]

/** تصنيفات الذمم الافتراضية وحسابات إيراداتها تحت المجموعة 41 */
export const DEFAULT_CHARGE_TYPES: { name: string; revenueName: string; installments: boolean }[] = [
  { name: 'الرسوم المدرسية', revenueName: 'إيرادات الرسوم المدرسية', installments: true },
  { name: 'القسط الدراسي', revenueName: 'إيرادات الأقساط الدراسية', installments: true },
  { name: 'رسوم التسجيل', revenueName: 'إيرادات رسوم التسجيل', installments: false },
  { name: 'الكتب', revenueName: 'إيرادات الكتب', installments: false },
  { name: 'الزي المدرسي', revenueName: 'إيرادات الزي المدرسي', installments: false },
  { name: 'اشتراك المطعم', revenueName: 'إيرادات المطعم', installments: true },
  { name: 'اشتراك الباص', revenueName: 'إيرادات النقل (الباص)', installments: true },
  { name: 'الأنشطة', revenueName: 'إيرادات الأنشطة', installments: false },
  { name: 'الرحلات', revenueName: 'إيرادات الرحلات', installments: false },
  { name: 'الامتحانات', revenueName: 'إيرادات الامتحانات', installments: false },
  { name: 'التأمين', revenueName: 'إيرادات التأمين', installments: false },
  { name: 'رسوم إضافية', revenueName: 'إيرادات رسوم إضافية', installments: false },
  { name: 'خدمات أخرى', revenueName: 'إيرادات خدمات أخرى', installments: false },
]

export const OPENING_BALANCE_CHARGE_TYPE = { name: 'رصيد سابق', systemKey: 'OPENING_BALANCE' }

export const DEFAULT_DISCOUNT_TYPES: { name: string; method?: 'PERCENT' | 'FIXED'; value?: number }[] = [
  { name: 'خصم إخوة', method: 'PERCENT', value: 10 },
  { name: 'خصم موظفين', method: 'PERCENT', value: 25 },
  { name: 'خصم تفوق', method: 'PERCENT', value: 10 },
  { name: 'خصم خاص' },
  { name: 'خصم من الإدارة' },
  { name: 'إعفاء بسبب الانسحاب' },
]

/** الطبيعة الطبيعية للحساب: 1 = رصيده مدين، -1 = رصيده دائن */
export function normalSign(type: AccountType): 1 | -1 {
  return type === 'ASSET' || type === 'EXPENSE' ? 1 : -1
}
