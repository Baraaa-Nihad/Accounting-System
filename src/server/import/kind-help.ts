import type { FieldKind } from './types'

/** وصف الصيغة المقبولة لكل نوع حقل (في القالب وشاشة الربط). */
export const KIND_HELP: Record<FieldKind, string> = {
  text: 'نص',
  amount: 'رقم موجب (يُقبل ١٥٠٠ أو 1,500)',
  signedAmount: 'رقم موجب أو سالب',
  integer: 'عدد صحيح',
  date: 'تاريخ: يوم/شهر/سنة (05/09/2026) أو تاريخ Excel',
  phone: 'رقم هاتف (يُقبل +970 أو 00970)',
  bool: 'نعم / لا',
  gender: 'ذكر / أنثى',
  studentStatus: 'فعال / منسحب / متخرج / موقوف',
  salaryType: 'شهري / يومي / بالساعة',
  paymentMethod: 'نقدي / تحويل بنكي / بطاقة / إلكتروني / أخرى',
  discount: 'مبلغ (500) أو نسبة (10%)',
}
