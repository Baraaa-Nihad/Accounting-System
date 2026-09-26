import { D, type MoneyLike } from './money'
import type { DateOnly } from './dates'

export interface FormatConfig {
  currencySymbol: string
  currencyCode: string
  decimals: number
  dateFormat: 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy'
  timezone: string
}

export const DEFAULT_FORMAT: FormatConfig = {
  currencySymbol: '₪',
  currencyCode: 'ILS',
  decimals: 2,
  dateFormat: 'dd/MM/yyyy',
  timezone: 'Asia/Hebron',
}

const numberFormatters = new Map<number, Intl.NumberFormat>()

function nf(decimals: number): Intl.NumberFormat {
  let f = numberFormatters.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    numberFormatters.set(decimals, f)
  }
  return f
}

/** 12,500.00 (بدون رمز العملة) */
export function formatAmount(value: MoneyLike, decimals: number): string {
  const d = D(value)
  // Intl يقبل النص للحفاظ على الدقة
  return nf(decimals).format(d.toFixed(decimals) as unknown as number)
}

/** 12,500.00 ₪ */
export function formatMoney(value: MoneyLike, cfg: Pick<FormatConfig, 'decimals' | 'currencySymbol'>): string {
  return `${formatAmount(value, cfg.decimals)} ${cfg.currencySymbol}`
}

export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === '') return ''
  return nf(decimals).format(Number(value))
}

export function formatPercent(value: MoneyLike, decimals = 2): string {
  const d = D(value)
  const s = d.toDecimalPlaces(decimals).toString()
  return `${s}%`
}

export function formatDate(value: DateOnly | Date | null | undefined, cfg: Pick<FormatConfig, 'dateFormat'>): string {
  if (!value) return ''
  const s = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
  const [y, m, d] = s.split('-')
  switch (cfg.dateFormat) {
    case 'yyyy-MM-dd':
      return `${y}-${m}-${d}`
    case 'dd-MM-yyyy':
      return `${d}-${m}-${y}`
    default:
      return `${d}/${m}/${y}`
  }
}

/** تاريخ ووقت بتوقيت المدرسة (لأوقات الإنشاء وسجل النشاط). */
export function formatDateTime(value: Date | string | null | undefined, cfg: Pick<FormatConfig, 'dateFormat' | 'timezone'>): string {
  if (!value) return ''
  const date = typeof value === 'string' ? new Date(value) : value
  let local: string
  try {
    local = new Intl.DateTimeFormat('en-CA', {
      timeZone: cfg.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    local = date.toISOString().replace('T', ', ').slice(0, 17)
  }
  // en-CA → "2026-09-26, 14:05"
  const [datePart, timePart] = local.split(', ')
  return `${formatDate(datePart, cfg)} ${timePart ?? ''}`.trim()
}
