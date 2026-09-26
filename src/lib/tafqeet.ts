/**
 * التفقيط: كتابة المبالغ بالحروف العربية للسندات الرسمية.
 * مثال: 1520.50 شيكل ← «فقط ألف وخمسمائة وعشرون شيكلًا وخمسون أغورة لا غير»
 */

type Gender = 'm' | 'f'

export interface CurrencyNoun {
  singular: string // شيكل
  dual: string // شيكلان
  plural: string // شواكل (3-10)
  accusative: string // شيكلًا (11-99)
  gender: Gender
}

export interface CurrencyWords {
  code: string
  name: string
  symbol: string
  decimals: number
  main: CurrencyNoun
  sub?: CurrencyNoun
  /** عدد الوحدات الفرعية في الوحدة الرئيسية (100 أو 1000) */
  subFactor?: number
}

const m = (singular: string, dual: string, plural: string, accusative: string): CurrencyNoun => ({
  singular,
  dual,
  plural,
  accusative,
  gender: 'm',
})
const f = (singular: string, dual: string, plural: string, accusative?: string): CurrencyNoun => ({
  singular,
  dual,
  plural,
  accusative: accusative ?? singular,
  gender: 'f',
})

export const CURRENCIES: CurrencyWords[] = [
  { code: 'ILS', name: 'شيكل', symbol: '₪', decimals: 2, main: m('شيكل', 'شيكلان', 'شواكل', 'شيكلًا'), sub: f('أغورة', 'أغورتان', 'أغورات'), subFactor: 100 },
  { code: 'JOD', name: 'دينار أردني', symbol: 'د.أ', decimals: 3, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('فلس', 'فلسان', 'فلوس', 'فلسًا'), subFactor: 1000 },
  { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س', decimals: 2, main: m('ريال', 'ريالان', 'ريالات', 'ريالًا'), sub: f('هللة', 'هللتان', 'هللات'), subFactor: 100 },
  { code: 'USD', name: 'دولار أمريكي', symbol: '$', decimals: 2, main: m('دولار', 'دولاران', 'دولارات', 'دولارًا'), sub: m('سنت', 'سنتان', 'سنتات', 'سنتًا'), subFactor: 100 },
  { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م', decimals: 2, main: m('جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'), sub: m('قرش', 'قرشان', 'قروش', 'قرشًا'), subFactor: 100 },
  { code: 'IQD', name: 'دينار عراقي', symbol: 'د.ع', decimals: 0, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا') },
  { code: 'KWD', name: 'دينار كويتي', symbol: 'د.ك', decimals: 3, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('فلس', 'فلسان', 'فلوس', 'فلسًا'), subFactor: 1000 },
  { code: 'BHD', name: 'دينار بحريني', symbol: 'د.ب', decimals: 3, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('فلس', 'فلسان', 'فلوس', 'فلسًا'), subFactor: 1000 },
  { code: 'OMR', name: 'ريال عماني', symbol: 'ر.ع', decimals: 3, main: m('ريال', 'ريالان', 'ريالات', 'ريالًا'), sub: f('بيسة', 'بيستان', 'بيسات'), subFactor: 1000 },
  { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ', decimals: 2, main: m('درهم', 'درهمان', 'دراهم', 'درهمًا'), sub: m('فلس', 'فلسان', 'فلوس', 'فلسًا'), subFactor: 100 },
  { code: 'QAR', name: 'ريال قطري', symbol: 'ر.ق', decimals: 2, main: m('ريال', 'ريالان', 'ريالات', 'ريالًا'), sub: m('درهم', 'درهمان', 'دراهم', 'درهمًا'), subFactor: 100 },
  { code: 'LYD', name: 'دينار ليبي', symbol: 'د.ل', decimals: 3, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('درهم', 'درهمان', 'دراهم', 'درهمًا'), subFactor: 1000 },
  { code: 'TND', name: 'دينار تونسي', symbol: 'د.ت', decimals: 3, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('مليم', 'مليمان', 'مليمات', 'مليمًا'), subFactor: 1000 },
  { code: 'DZD', name: 'دينار جزائري', symbol: 'د.ج', decimals: 2, main: m('دينار', 'ديناران', 'دنانير', 'دينارًا'), sub: m('سنتيم', 'سنتيمان', 'سنتيمات', 'سنتيمًا'), subFactor: 100 },
  { code: 'MAD', name: 'درهم مغربي', symbol: 'د.م', decimals: 2, main: m('درهم', 'درهمان', 'دراهم', 'درهمًا'), sub: m('سنتيم', 'سنتيمان', 'سنتيمات', 'سنتيمًا'), subFactor: 100 },
  { code: 'SYP', name: 'ليرة سورية', symbol: 'ل.س', decimals: 0, main: f('ليرة', 'ليرتان', 'ليرات') },
  { code: 'LBP', name: 'ليرة لبنانية', symbol: 'ل.ل', decimals: 0, main: f('ليرة', 'ليرتان', 'ليرات') },
  { code: 'YER', name: 'ريال يمني', symbol: 'ر.ي', decimals: 0, main: m('ريال', 'ريالان', 'ريالات', 'ريالًا') },
  { code: 'SDG', name: 'جنيه سوداني', symbol: 'ج.س', decimals: 2, main: m('جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'), sub: m('قرش', 'قرشان', 'قروش', 'قرشًا'), subFactor: 100 },
  { code: 'EUR', name: 'يورو', symbol: '€', decimals: 2, main: m('يورو', 'يوروان', 'يورو', 'يورو'), sub: m('سنت', 'سنتان', 'سنتات', 'سنتًا'), subFactor: 100 },
]

export function findCurrency(code: string): CurrencyWords {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]
}

const ONES_M = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة']
const ONES_F = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثماني', 'تسع']
const TEENS_M = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TEENS_F = ['عشر', 'إحدى عشرة', 'اثنتا عشرة', 'ثلاث عشرة', 'أربع عشرة', 'خمس عشرة', 'ست عشرة', 'سبع عشرة', 'ثماني عشرة', 'تسع عشرة']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']

const SCALES: CurrencyNoun[] = [
  m('ألف', 'ألفان', 'آلاف', 'ألفًا'),
  m('مليون', 'مليونان', 'ملايين', 'مليونًا'),
  m('مليار', 'ملياران', 'مليارات', 'مليارًا'),
]

function below100(n: number, g: Gender): string {
  const ones = g === 'f' ? ONES_F : ONES_M
  if (n === 0) return ''
  if (n < 10) return ones[n]
  if (n < 20) return (g === 'f' ? TEENS_F : TEENS_M)[n - 10]
  const u = n % 10
  const t = Math.floor(n / 10)
  if (u === 0) return TENS[t]
  // «إحدى وعشرون» للمؤنث و«واحد وعشرون» للمذكر
  const unit = u === 1 ? (g === 'f' ? 'إحدى' : 'واحد') : u === 2 ? (g === 'f' ? 'اثنتان' : 'اثنان') : ones[u]
  return `${unit} و${TENS[t]}`
}

function below1000(n: number, g: Gender): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const partsList = [HUNDREDS[h], below100(r, g)].filter(Boolean)
  return partsList.join(' و')
}

/** العدد مع المعدود حسب قواعد العدد والمعدود المبسطة. */
function countNoun(n: number, noun: CurrencyNoun): string {
  if (n === 0) return ''
  if (n === 1) return `${noun.singular} ${noun.gender === 'f' ? 'واحدة' : 'واحد'}`
  if (n === 2) return noun.dual
  const words = numberToWords(n, noun.gender)
  const lastTwo = n % 100
  if (lastTwo >= 3 && lastTwo <= 10) return `${words} ${noun.plural}`
  if (lastTwo >= 11 && lastTwo <= 99) return `${words} ${noun.accusative}`
  return `${words} ${noun.singular}`
}

/** كتابة عدد صحيح بالحروف (بدون معدود). */
export function numberToWords(n: number, gender: Gender = 'm'): string {
  if (!Number.isFinite(n) || n < 0) return ''
  n = Math.floor(n)
  if (n === 0) return 'صفر'
  const groups: number[] = []
  let x = n
  while (x > 0) {
    groups.push(x % 1000)
    x = Math.floor(x / 1000)
  }
  const out: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    if (i === 0) {
      out.push(below1000(g, gender))
      continue
    }
    const scale = SCALES[i - 1] ?? SCALES[SCALES.length - 1]
    if (g === 1) out.push(scale.singular)
    else if (g === 2) out.push(scale.dual)
    else {
      const lastTwo = g % 100
      if (lastTwo === 1 || lastTwo === 2) {
        // 101 ألف ← «مائة ألف وألف»
        const rest = g - lastTwo
        out.push(`${below1000(rest, 'm')} ${scale.singular}`)
        out.push(lastTwo === 1 ? scale.singular : scale.dual)
      } else if (lastTwo >= 3 && lastTwo <= 10) {
        out.push(`${below1000(g, 'm')} ${scale.plural}`)
      } else if (lastTwo >= 11) {
        out.push(`${below1000(g, 'm')} ${scale.accusative}`)
      } else {
        out.push(`${below1000(g, 'm')} ${scale.singular}`)
      }
    }
  }
  return out.join(' و')
}

/** التفقيط الكامل للمبلغ مع العملة. */
export function amountToArabicWords(amount: number | string, currencyCode: string): string {
  const currency = findCurrency(currencyCode)
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(value)) return ''
  const negative = value < 0
  const abs = Math.abs(value)
  const factor = currency.subFactor ?? 100
  const decimals = currency.decimals
  const scaled = Math.round(abs * 10 ** decimals)
  const intPart = Math.floor(scaled / 10 ** decimals)
  const fracUnits = decimals > 0 ? scaled % 10 ** decimals : 0
  // تحويل الكسر إلى وحدات فرعية
  const subUnits = decimals > 0 ? Math.round((fracUnits / 10 ** decimals) * factor) : 0

  const main = intPart > 0 ? countNoun(intPart, currency.main) : ''
  const sub = subUnits > 0 && currency.sub ? countNoun(subUnits, currency.sub) : ''
  let body: string
  if (main && sub) body = `${main} و${sub}`
  else if (main) body = main
  else if (sub) body = sub
  else body = `صفر ${currency.main.singular}`
  return `فقط ${negative ? 'سالب ' : ''}${body} لا غير`
}
