/**
 * التواريخ المالية تُعامل كنص بصيغة YYYY-MM-DD (تاريخ بلا وقت)،
 * وتُخزن في القاعدة كنوع DATE (منتصف الليل UTC) لتجنب مشاكل المناطق الزمنية.
 */

export type DateOnly = string // 'YYYY-MM-DD'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

/** من Date (القادم من عمود DATE) إلى 'YYYY-MM-DD'. */
export function toDateOnly(date: Date): DateOnly {
  return date.toISOString().slice(0, 10)
}

/** من 'YYYY-MM-DD' إلى Date بمنتصف الليل UTC للكتابة في عمود DATE. */
export function fromDateOnly(value: DateOnly): Date {
  if (!isDateOnly(value)) throw new Error(`INVALID_DATE:${value}`)
  return new Date(`${value}T00:00:00.000Z`)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** تاريخ اليوم حسب المنطقة الزمنية للمدرسة. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): DateOnly {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return toDateOnly(now)
  }
}

export function parts(value: DateOnly): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number)
  return { y, m, d }
}

export function makeDate(y: number, m: number, d: number): DateOnly {
  // يضبط الشهر والسنة إن خرج الشهر عن النطاق
  const date = new Date(Date.UTC(y, m - 1, 1))
  const yy = date.getUTCFullYear()
  const mm = date.getUTCMonth() + 1
  const dd = Math.min(d, daysInMonth(yy, mm))
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/**
 * إضافة أشهر مع تثبيت يوم الاستحقاق.
 * إذا كان اليوم المطلوب أكبر من عدد أيام الشهر يُستخدم آخر يوم (31 → 28/29/30).
 */
export function addMonths(value: DateOnly, months: number, dayOfMonth?: number): DateOnly {
  const { y, m, d } = parts(value)
  return makeDate(y, m + months, dayOfMonth ?? d)
}

export function addDays(value: DateOnly, days: number): DateOnly {
  const date = fromDateOnly(value)
  date.setUTCDate(date.getUTCDate() + days)
  return toDateOnly(date)
}

export function diffDays(later: DateOnly, earlier: DateOnly): number {
  return Math.round((fromDateOnly(later).getTime() - fromDateOnly(earlier).getTime()) / 86_400_000)
}

export function startOfMonth(value: DateOnly): DateOnly {
  const { y, m } = parts(value)
  return makeDate(y, m, 1)
}

export function endOfMonth(value: DateOnly): DateOnly {
  const { y, m } = parts(value)
  return makeDate(y, m, daysInMonth(y, m))
}

/** بداية الأسبوع (weekStartDay: 0 = الأحد ... 6 = السبت). */
export function startOfWeek(value: DateOnly, weekStartDay: number): DateOnly {
  const dow = fromDateOnly(value).getUTCDay()
  const diff = (dow - weekStartDay + 7) % 7
  return addDays(value, -diff)
}

export function endOfWeek(value: DateOnly, weekStartDay: number): DateOnly {
  return addDays(startOfWeek(value, weekStartDay), 6)
}

export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function monthKey(value: DateOnly): string {
  return value.slice(0, 7)
}

export const ARABIC_MONTHS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
]

export function monthName(month: number): string {
  return ARABIC_MONTHS[(month - 1 + 12) % 12]
}

/**
 * يحاول فهم تاريخ مكتوب بصيغ مختلفة (من Excel أو إدخال المستخدم):
 * YYYY-MM-DD، DD/MM/YYYY، D-M-YYYY، رقم تاريخ Excel، كائن Date.
 */
export function parseFlexibleDate(input: unknown): DateOnly | null {
  if (input === null || input === undefined || input === '') return null
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null
    return toDateOnly(input)
  }
  if (typeof input === 'number') {
    if (input > 20000 && input < 80000) {
      // رقم تاريخ Excel (عدد الأيام منذ 1899-12-30)
      const ms = Math.round((input - 25569) * 86_400_000)
      return toDateOnly(new Date(ms))
    }
    return null
  }
  const s = String(input)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) {
    const v = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    return isDateOnly(v) ? v : null
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) {
    const v = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return isDateOnly(v) ? v : null
  }
  if (/^\d{5}$/.test(s)) return parseFlexibleDate(Number(s))
  return null
}
