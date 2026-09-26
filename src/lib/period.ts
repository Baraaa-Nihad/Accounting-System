import { addMonths, endOfMonth, isDateOnly, startOfMonth, type DateOnly } from './dates'

/**
 * اختيار الفترة الموحد للصفحات والتقارير:
 * السنة الدراسية المختارة (افتراضي)، هذا الشهر، الشهر الماضي، كل الفترات، أو فترة مخصصة.
 */
export type PeriodKey = 'year' | 'month' | 'last-month' | 'all' | 'custom'

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  year: 'السنة الدراسية المختارة',
  month: 'هذا الشهر',
  'last-month': 'الشهر الماضي',
  all: 'كل الفترات',
  custom: 'فترة مخصصة',
}

export interface ResolvedPeriod {
  key: PeriodKey
  from: DateOnly | null
  to: DateOnly | null
}

export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  ctx: { today: DateOnly; year: { startDate: DateOnly; endDate: DateOnly } | null },
  fallback: PeriodKey = 'year',
): ResolvedPeriod {
  const from = isDateOnly(params.from) ? params.from : null
  const to = isDateOnly(params.to) ? params.to : null
  const requested = params.period as PeriodKey | undefined
  const key: PeriodKey = from || to ? 'custom' : requested && requested in PERIOD_LABELS ? requested : fallback
  switch (key) {
    case 'custom':
      return { key, from, to }
    case 'month':
      return { key, from: startOfMonth(ctx.today), to: endOfMonth(ctx.today) }
    case 'last-month': {
      const d = addMonths(startOfMonth(ctx.today), -1)
      return { key, from: d, to: endOfMonth(d) }
    }
    case 'all':
      return { key, from: null, to: null }
    case 'year':
    default:
      return ctx.year ? { key: 'year', from: ctx.year.startDate, to: ctx.year.endDate } : { key: 'all', from: null, to: null }
  }
}
