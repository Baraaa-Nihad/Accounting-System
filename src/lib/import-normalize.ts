import { normalizeArabic, toLatinDigits } from './arabic'
import { parseFlexibleDate, type DateOnly } from './dates'
import { parseAmountInput } from './money'

/**
 * تنظيف قيم ملفات Excel (docs/12-excel-import.md §12.3).
 * كل دالة تعيد { value } عند النجاح أو { error } برسالة عربية.
 */

export type Cell = string | number | boolean | Date | null | undefined
export type Parsed<T> = { value: T; error?: undefined } | { value?: undefined; error: string }

/** نص نظيف: إزالة المسافات الزائدة والأحرف المخفية. */
export function cleanText(v: Cell): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v)
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s === '' ? null : s
}

export function parseAmount(v: Cell, opts?: { allowNegative?: boolean; allowZero?: boolean }): Parsed<string> {
  if (typeof v === 'boolean' || v instanceof Date) return { error: 'قيمة غير رقمية' }
  const d = parseAmountInput(typeof v === 'number' ? v : (cleanText(v) ?? ''))
  if (!d) return { error: 'رقم غير صالح' }
  if (d.isNegative() && !opts?.allowNegative) return { error: 'لا يُقبل رقم سالب' }
  if (d.isZero() && !opts?.allowZero) return { error: 'يجب أن يكون أكبر من صفر' }
  if (d.abs().greaterThan('999999999999')) return { error: 'رقم كبير جدًا' }
  return { value: d.toString() }
}

export function parseInteger(v: Cell, min = 1, max = 1000): Parsed<number> {
  const a = parseAmount(v, { allowZero: min <= 0 })
  if (a.error !== undefined) return { error: a.error }
  const n = Number(a.value)
  if (!Number.isInteger(n) || n < min || n > max) return { error: `عدد صحيح بين ${min} و ${max}` }
  return { value: n }
}

export function parseDate(v: Cell): Parsed<DateOnly> {
  if (typeof v === 'boolean') return { error: 'تاريخ غير مفهوم' }
  const d = parseFlexibleDate(v instanceof Date || typeof v === 'number' ? v : cleanText(v))
  if (!d) return { error: 'تاريخ غير مفهوم (استخدم يوم/شهر/سنة مثل 05/09/2026)' }
  const y = Number(d.slice(0, 4))
  if (y < 1990 || y > 2100) return { error: 'سنة غير منطقية' }
  return { value: d }
}

/** رقم الهاتف المحلي: «+970 599-123-456» ← «0599123456». */
export function parsePhone(v: Cell, dialCode: string): Parsed<string> {
  const raw = toLatinDigits(cleanText(typeof v === 'number' ? String(v) : v) ?? '')
  let digits = raw.replace(/\D/g, '')
  if (!digits) return { error: 'رقم هاتف غير صالح' }
  const code = dialCode.replace(/\D/g, '')
  if (code) {
    if (digits.startsWith(`00${code}`)) digits = `0${digits.slice(code.length + 2)}`
    else if ((raw.trim().startsWith('+') || digits.length > 10) && digits.startsWith(code)) digits = `0${digits.slice(code.length)}`
  }
  // Excel يحذف الصفر الأول من الأرقام
  if (typeof v === 'number' && digits.length === 9 && !digits.startsWith('0')) digits = `0${digits}`
  if (digits.length < 7 || digits.length > 15) return { error: 'رقم هاتف غير صالح' }
  return { value: digits }
}

const TRUE_WORDS = ['نعم', 'yes', 'y', 'true', '1', '✓', '✔', 'x', 'صح']
const FALSE_WORDS = ['لا', 'no', 'n', 'false', '0', '✗', '']

export function parseBool(v: Cell): Parsed<boolean> {
  if (typeof v === 'boolean') return { value: v }
  const s = normalizeArabic(cleanText(v === undefined || v === null ? '' : String(v)) ?? '')
  if (TRUE_WORDS.includes(s)) return { value: true }
  if (FALSE_WORDS.includes(s)) return { value: false }
  return { error: 'اكتب نعم أو لا' }
}

function choice<T extends string>(v: Cell, table: Record<T, string[]>, message: string): Parsed<T> {
  const s = normalizeArabic(cleanText(v === undefined || v === null ? '' : String(v)) ?? '')
  for (const [key, words] of Object.entries(table) as [T, string[]][]) {
    if (words.some((w) => normalizeArabic(w) === s)) return { value: key }
  }
  return { error: message }
}

export const parseGender = (v: Cell) =>
  choice(v, { MALE: ['ذكر', 'm', 'male', 'boy', 'ولد', 'طالب'], FEMALE: ['أنثى', 'انثى', 'f', 'female', 'girl', 'بنت', 'طالبة'] }, 'اكتب ذكر أو أنثى')

export const parseStudentStatus = (v: Cell) =>
  choice(
    v,
    {
      ACTIVE: ['فعال', 'نشط', 'active', 'مسجل'],
      WITHDRAWN: ['منسحب', 'withdrawn', 'انسحب'],
      GRADUATED: ['متخرج', 'graduated', 'خريج'],
      SUSPENDED: ['موقوف', 'suspended', 'متوقف'],
    },
    'الحالة: فعال، منسحب، متخرج، أو موقوف',
  )

export const parseSalaryType = (v: Cell) =>
  choice(v, { MONTHLY: ['شهري', 'monthly', 'شهر'], DAILY: ['يومي', 'daily', 'يوم'], HOURLY: ['بالساعة', 'ساعة', 'hourly', 'ساعي'] }, 'نوع الراتب: شهري، يومي، أو بالساعة')

export const parsePaymentMethod = (v: Cell) =>
  choice(
    v,
    {
      CASH: ['نقدي', 'نقدا', 'نقدًا', 'كاش', 'cash'],
      CHEQUE: ['شيك', 'cheque', 'check'],
      BANK_TRANSFER: ['تحويل', 'تحويل بنكي', 'حوالة', 'bank', 'transfer'],
      CARD: ['بطاقة', 'فيزا', 'card', 'visa'],
      ELECTRONIC: ['الكتروني', 'إلكتروني', 'دفع الكتروني', 'online', 'electronic'],
      OTHER: ['أخرى', 'اخرى', 'other'],
    },
    'طريقة الدفع: نقدي، تحويل بنكي، بطاقة، إلكتروني، أو أخرى',
  )

/** الخصم: «10%» نسبة، «500» مبلغ ثابت. */
export function parseDiscount(v: Cell): Parsed<{ method: 'PERCENT' | 'FIXED'; value: string }> {
  const s = toLatinDigits(cleanText(v === undefined || v === null ? '' : String(v)) ?? '')
  if (!s) return { error: 'خصم غير صالح' }
  const isPercent = /[%٪]/.test(s)
  const a = parseAmount(s.replace(/[%٪]/g, ''))
  if (a.error !== undefined) return { error: 'خصم غير صالح (مثال: 500 أو 10%)' }
  if (isPercent && Number(a.value) > 100) return { error: 'نسبة الخصم لا تتجاوز 100%' }
  return { value: { method: isPercent ? 'PERCENT' : 'FIXED', value: a.value } }
}

/** مفتاح مقارنة للأسماء (تطبيع عربي). */
export const nameKey = (v: string | null | undefined) => normalizeArabic(v ?? '')
