import Decimal from 'decimal.js'

/**
 * أدوات المبالغ المالية.
 * لا يُستخدم النوع number في أي حساب مالي؛ كل العمليات عبر Decimal
 * ثم التقريب لعدد منازل العملة بقاعدة ROUND_HALF_UP.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export type MoneyLike = Decimal | string | number | { toString(): string } | null | undefined

export const ZERO = new Decimal(0)

/** تحويل أي قيمة (Prisma Decimal، نص، رقم) إلى Decimal. */
export function D(value: MoneyLike): Decimal {
  if (value === null || value === undefined || value === '') return ZERO
  if (value instanceof Decimal) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_AMOUNT')
    return new Decimal(value)
  }
  return new Decimal(value.toString())
}

/** تقريب مبلغ لعدد المنازل العشرية للعملة. */
export function round(value: MoneyLike, decimals: number): Decimal {
  return D(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
}

export function sum(values: MoneyLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), ZERO)
}

export function max(a: MoneyLike, b: MoneyLike): Decimal {
  return Decimal.max(D(a), D(b))
}

export function min(a: MoneyLike, b: MoneyLike): Decimal {
  return Decimal.min(D(a), D(b))
}

/** قيمة جاهزة للكتابة في عمود NUMERIC(15,3). */
export function toDb(value: MoneyLike): string {
  return D(value).toFixed(3)
}

/** للإرسال إلى الواجهة (عرض فقط، لا يُستخدم في الحسابات المعتمدة). */
export function toNum(value: MoneyLike): number {
  return D(value).toNumber()
}

/** قيمة الخصم بالنسبة المئوية. */
export function percentOf(base: MoneyLike, percent: MoneyLike, decimals: number): Decimal {
  return round(D(base).times(D(percent)).dividedBy(100), decimals)
}

/**
 * تقسيم مبلغ على عدد أجزاء متساوية، وفرق التقريب يُضاف لآخر جزء.
 * مثال: 1000 ÷ 3 → 333.33، 333.33، 333.34
 */
export function splitEven(total: MoneyLike, parts: number, decimals: number): Decimal[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('INVALID_PARTS')
  const t = round(total, decimals)
  const base = t.dividedBy(parts).toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
  const result: Decimal[] = Array.from({ length: parts }, () => base)
  const remainder = t.minus(base.times(parts))
  result[parts - 1] = base.plus(remainder)
  return result
}

/**
 * توزيع مبلغ على عدة أوزان بالتناسب (طريقة الباقي الأكبر)، بحيث:
 * - مجموع الحصص = المبلغ تمامًا
 * - لا تتجاوز أي حصة وزنها إذا كان المبلغ ≤ مجموع الأوزان
 */
export function distributeProportional(total: MoneyLike, weights: MoneyLike[], decimals: number): Decimal[] {
  const unit = new Decimal(1).dividedBy(new Decimal(10).pow(decimals))
  const t = round(total, decimals)
  const w = weights.map((x) => D(x))
  const W = sum(w)
  if (w.length === 0) return []
  if (W.isZero()) {
    const result = w.map(() => ZERO)
    result[result.length - 1] = t
    return result
  }
  const exact = w.map((x) => t.times(x).dividedBy(W))
  const floors = exact.map((x) => x.toDecimalPlaces(decimals, Decimal.ROUND_DOWN))
  let remaining = t.minus(sum(floors))
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(floors[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i)
  const result = [...floors]
  let k = 0
  while (remaining.greaterThan(0) && order.length > 0) {
    const idx = order[k % order.length].i
    result[idx] = result[idx].plus(unit)
    remaining = remaining.minus(unit)
    k++
  }
  return result
}

/** يحوّل نصًا مُدخلًا من المستخدم (قد يحتوي أرقامًا عربية أو فواصل) إلى رقم، أو null إذا لم يكن صالحًا. */
export function parseAmountInput(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? new Decimal(input) : null
  const cleaned = input
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.')
    .trim()
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null
  try {
    return new Decimal(cleaned)
  } catch {
    return null
  }
}
