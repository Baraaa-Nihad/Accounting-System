import * as React from 'react'
import { D, type MoneyLike } from './money'
import { formatAmount, formatDate, formatDateTime, formatNumber, type FormatConfig } from './format'
import { cn } from './utils'

/**
 * منسقات العرض (تعمل في مكونات الخادم والمتصفح):
 * المبلغ داخل عزل LTR حتى تظهر الإشارة السالبة والفواصل صحيحة داخل النص العربي،
 * ورمز العملة بعده في ترتيب القراءة العربية.
 */
export function makeFormatters(cfg: FormatConfig) {
  return {
    cfg,
    amount: (v: MoneyLike) => formatAmount(v, cfg.decimals),
    moneyText: (v: MoneyLike) => `${formatAmount(v, cfg.decimals)} ${cfg.currencySymbol}`,
    money: (v: MoneyLike, opts?: { className?: string; colored?: boolean; hideZero?: boolean; symbol?: boolean }) => {
      const d = D(v)
      if (opts?.hideZero && d.isZero()) return <span className="text-slate-300">—</span>
      const color = opts?.colored ? (d.isNegative() ? 'text-rose-600' : d.isZero() ? 'text-slate-400' : '') : ''
      return (
        <span className={cn('whitespace-nowrap', color, opts?.className)}>
          <bdi className="ltr num">{formatAmount(d, cfg.decimals)}</bdi>
          {opts?.symbol === false ? null : <span className="ms-1 text-[0.82em] font-normal text-slate-400">{cfg.currencySymbol}</span>}
        </span>
      )
    },
    date: (v: string | Date | null | undefined) => (v ? <bdi className="ltr num whitespace-nowrap">{formatDate(v, cfg)}</bdi> : null),
    dateText: (v: string | Date | null | undefined) => formatDate(v, cfg),
    dateTime: (v: string | Date | null | undefined) =>
      v ? <bdi className="ltr num whitespace-nowrap">{formatDateTime(v, cfg)}</bdi> : null,
    dateTimeText: (v: string | Date | null | undefined) => formatDateTime(v, cfg),
    number: (v: number | string | null | undefined, decimals = 0) => <bdi className="ltr num">{formatNumber(v, decimals)}</bdi>,
  }
}

export type Formatters = ReturnType<typeof makeFormatters>
