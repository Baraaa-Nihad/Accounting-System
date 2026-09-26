/** أدوات النص العربي: تطبيع للبحث، تحويل الأرقام، تنظيف أرقام الهواتف. */

export function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
}

/**
 * تطبيع النص العربي للبحث: توحيد أشكال الألف والياء والتاء المربوطة،
 * إزالة التشكيل والتطويل، الأرقام اللاتينية، أحرف صغيرة، مسافات موحدة.
 * «أحمد» = «احمد»، «فاطمة» = «فاطمه»، «مصطفى» = «مصطفي».
 */
export function normalizeArabic(value: string | null | undefined): string {
  if (!value) return ''
  return toLatinDigits(value)
    .normalize('NFKC')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** نص البحث المخزن: كل الحقول مطبّعة ومفصولة بمسافة، والهواتف أرقام فقط. */
export function buildSearchText(values: Array<string | null | undefined>): string {
  return values
    .filter((v): v is string => !!v && v.trim() !== '')
    .map((v) => {
      const n = normalizeArabic(v)
      const digits = n.replace(/\D/g, '')
      // للهواتف والأرقام: نخزن النسخة الرقمية أيضًا
      return digits.length >= 6 && digits.length !== n.length ? `${n} ${digits}` : n
    })
    .join(' ')
}

/** تنظيف رقم الهاتف: أرقام فقط مع الحفاظ على + في البداية إن وُجدت. */
export function cleanPhone(value: string | null | undefined): string | null {
  if (!value) return null
  const s = toLatinDigits(value).trim()
  const plus = s.startsWith('+') || s.startsWith('00')
  const digits = s.replace(/\D/g, '')
  if (!digits) return null
  if (plus) return `+${digits.replace(/^00/, '')}`
  return digits
}

/** مقارنة هاتفين بغض النظر عن رمز الدولة والصفر الأول. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? '').replace(/\D/g, '').replace(/^0+/, '')
  const nb = (b ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (na.length < 6 || nb.length < 6) return false
  return na.endsWith(nb.slice(-9)) || nb.endsWith(na.slice(-9))
}

/** تجهيز نص البحث المُدخل: يُطبّع ويعيد نسخة رقمية إن كان رقمًا. */
export function prepareSearchQuery(q: string): { text: string; digits: string } {
  const text = normalizeArabic(q)
  const digits = text.replace(/\D/g, '')
  return { text, digits }
}
