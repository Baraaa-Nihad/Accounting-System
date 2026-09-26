/** التسميات العربية الموحدة لكل الحالات والأنواع في النظام. */

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'teal' | 'violet'

export const STUDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'فعال', tone: 'green' },
  WITHDRAWN: { label: 'منسحب', tone: 'red' },
  GRADUATED: { label: 'متخرج', tone: 'blue' },
  SUSPENDED: { label: 'موقوف', tone: 'amber' },
}

export const GENDER: Record<string, string> = { MALE: 'ذكر', FEMALE: 'أنثى' }

export const ENROLLMENT_STATUS: Record<string, string> = {
  ACTIVE: 'مسجل',
  PROMOTED: 'تم ترحيله',
  REPEATED: 'معيد',
  GRADUATED: 'متخرج',
  WITHDRAWN: 'منسحب',
}

export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'فعال', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  UNPAID: { label: 'غير مدفوع', tone: 'blue' },
  PARTIAL: { label: 'مدفوع جزئيًا', tone: 'amber' },
  PAID: { label: 'مدفوع', tone: 'green' },
}

/** حالة القسط المعروضة (تُحسب من حالة السداد وتاريخ الاستحقاق). */
export const INSTALLMENT_DISPLAY: Record<string, { label: string; tone: Tone }> = {
  NOT_DUE: { label: 'غير مستحق', tone: 'blue' },
  DUE: { label: 'مستحق', tone: 'amber' },
  OVERDUE: { label: 'متأخر', tone: 'red' },
  PARTIAL: { label: 'مدفوع جزئيًا', tone: 'amber' },
  PARTIAL_OVERDUE: { label: 'جزئي متأخر', tone: 'red' },
  PAID: { label: 'مدفوع', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const DISCOUNT_METHOD: Record<string, string> = { PERCENT: 'نسبة مئوية', FIXED: 'مبلغ ثابت' }

export const DISCOUNT_SCOPE: Record<string, string> = {
  CHARGE: 'ذمة معينة',
  CHARGE_TYPE: 'نوع رسوم معين',
  ACCOUNT: 'كامل حساب الطالب',
}

export const DISCOUNT_DISTRIBUTION: Record<string, string> = {
  EVEN: 'بالتساوي على الأقساط غير المدفوعة',
  FROM_LAST: 'من آخر الأقساط',
}

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'نقدي',
  CHEQUE: 'شيك',
  BANK_TRANSFER: 'حوالة بنكية',
  CARD: 'بطاقة',
  ELECTRONIC: 'دفع إلكتروني',
  OTHER: 'أخرى',
}

export const RECEIPT_KIND: Record<string, string> = {
  STUDENT: 'دفعة طالب',
  FAMILY: 'دفعة عائلية',
  OTHER_REVENUE: 'إيراد آخر',
  PARTNER_CAPITAL: 'رأس مال شريك',
  OPENING_CREDIT: 'رصيد دائن افتتاحي',
}

export const VOUCHER_KIND: Record<string, string> = {
  EXPENSE: 'مصروف',
  SUPPLIER_PAYMENT: 'دفعة لمورد',
  CONTRACTOR_PAYMENT: 'دفعة لمقاول/عامل',
  SALARY: 'راتب',
  ADVANCE: 'سلفة موظف',
  STUDENT_REFUND: 'مرتجع لطالب',
  PARTNER_WITHDRAWAL: 'سحب شريك',
  OTHER: 'أخرى',
}

export const CASH_ACCOUNT_TYPE: Record<string, string> = { CASHBOX: 'صندوق', BANK: 'حساب بنكي' }

export const CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  IN_PORTFOLIO: { label: 'في الحافظة', tone: 'amber' },
  CLEARED: { label: 'محصّل', tone: 'green' },
  BOUNCED: { label: 'مرتجع', tone: 'red' },
  ISSUED: { label: 'صادر', tone: 'blue' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const SALARY_TYPE: Record<string, string> = { MONTHLY: 'شهري', DAILY: 'يومي', HOURLY: 'بالساعة' }

export const EMPLOYEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'على رأس العمل', tone: 'green' },
  INACTIVE: { label: 'غير فعال', tone: 'gray' },
}

export const PAYROLL_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'مسودة', tone: 'amber' },
  APPROVED: { label: 'معتمد', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const ADVANCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'قيد السداد', tone: 'amber' },
  SETTLED: { label: 'مسددة', tone: 'green' },
  CANCELLED: { label: 'ملغاة', tone: 'gray' },
}

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'جارٍ', tone: 'amber' },
  COMPLETED: { label: 'منتهي', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const OVERTIME_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'بانتظار الرواتب', tone: 'amber' },
  INCLUDED: { label: 'أُضيف للراتب', tone: 'green' },
  CANCELLED: { label: 'ملغي', tone: 'gray' },
}

export const ACCOUNT_TYPE: Record<string, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
}

export const YEAR_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'مفتوحة', tone: 'green' },
  CLOSED: { label: 'مغلقة', tone: 'gray' },
}

export const JOURNAL_SOURCE: Record<string, string> = {
  MANUAL: 'قيد يدوي',
  CHARGE: 'ذمة طالب',
  CHARGE_CANCEL: 'إلغاء ذمة',
  CHARGE_REDUCE: 'تخفيض ذمة',
  DISCOUNT: 'خصم',
  DISCOUNT_CANCEL: 'إلغاء خصم',
  RECEIPT: 'سند قبض',
  RECEIPT_CANCEL: 'إلغاء سند قبض',
  VOUCHER: 'سند صرف',
  VOUCHER_CANCEL: 'إلغاء سند صرف',
  TRANSFER: 'تحويل',
  TRANSFER_CANCEL: 'إلغاء تحويل',
  CHEQUE_CLEAR: 'تحصيل شيك',
  SUPPLIER_BILL: 'فاتورة مورد',
  SUPPLIER_BILL_CANCEL: 'إلغاء فاتورة مورد',
  CONTRACTOR_JOB: 'اتفاق مقاول',
  CONTRACTOR_JOB_ADJUST: 'تعديل اتفاق مقاول',
  PAYROLL: 'مسير رواتب',
  PAYROLL_CANCEL: 'إلغاء مسير رواتب',
  OPENING: 'رصيد افتتاحي',
  YEAR_CLOSING: 'إقفال سنة',
  YEAR_REOPEN: 'إعادة فتح سنة',
  REVERSAL: 'قيد عكسي',
}

export const AUDIT_ACTION: Record<string, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  cancel: 'إلغاء',
  approve: 'اعتماد',
  pay: 'صرف',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  login_failed: 'دخول فاشل',
  password: 'تغيير كلمة المرور',
  permissions: 'تغيير صلاحيات',
  unlock: 'فك قفل حساب',
  export: 'تصدير',
  import: 'استيراد',
  backup: 'نسخ احتياطي',
  restore: 'استعادة نسخة',
  close_year: 'إغلاق سنة',
  reopen_year: 'إعادة فتح سنة',
  promote: 'ترحيل طلاب',
  reschedule: 'إعادة جدولة',
  allocate: 'توزيع دفعة',
  clear: 'تحصيل شيك',
  bounce: 'شيك مرتجع',
  status: 'تغيير حالة',
  settings: 'تعديل الإعدادات',
}

export const ENTITY_LABEL: Record<string, string> = {
  User: 'مستخدم',
  Role: 'دور',
  Student: 'طالب',
  Guardian: 'ولي أمر',
  Charge: 'ذمة',
  Installment: 'قسط',
  Discount: 'خصم',
  Receipt: 'سند قبض',
  PaymentVoucher: 'سند صرف',
  CashTransfer: 'تحويل',
  CashAccount: 'صندوق/بنك',
  Cheque: 'شيك',
  Employee: 'موظف',
  PayrollRun: 'مسير رواتب',
  OvertimeEntry: 'ساعات إضافية',
  EmployeeAdvance: 'سلفة',
  Supplier: 'مورد',
  SupplierBill: 'فاتورة مورد',
  Contractor: 'مقاول',
  ContractorJob: 'عمل مقاول',
  Partner: 'شريك',
  Account: 'حساب',
  JournalEntry: 'قيد',
  AcademicYear: 'سنة دراسية',
  Setting: 'إعدادات',
  ChargeType: 'تصنيف ذمة',
  DiscountType: 'نوع خصم',
  FeePlan: 'رسوم مقررة',
  Grade: 'صف',
  Stage: 'مرحلة',
  Section: 'شعبة',
  ImportBatch: 'استيراد',
  Backup: 'نسخة احتياطية',
  Attachment: 'مرفق',
  Session: 'جلسة',
  System: 'النظام',
}

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return ''
  return map[key] ?? key
}
