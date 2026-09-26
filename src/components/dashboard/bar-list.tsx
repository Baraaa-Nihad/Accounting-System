'use client'

import * as React from 'react'
import { useFormat } from '@/components/providers/app-provider'
import { D, sum } from '@/lib/money'
import { CHART } from './chart-tokens'

/** قائمة أعمدة أفقية لسلسلة واحدة (لون واحد): الاسم، العمود، والقيمة عند طرفه، والنسبة في التلميح. */
export function BarList({ items, emptyText }: { items: { key: string; name: string; value: string; href?: string }[]; emptyText: string }) {
  const f = useFormat()
  const total = sum(items.map((i) => i.value))
  const max = items.reduce((m, i) => (D(i.value).greaterThan(m) ? D(i.value) : m), D(0))
  if (items.length === 0 || max.isZero()) return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>
  return (
    <ul className="space-y-2.5">
      {items.map((i) => {
        const pct = D(i.value).dividedBy(max).times(100).toNumber()
        const share = total.isZero() ? 0 : D(i.value).dividedBy(total).times(100).toNumber()
        const body = (
          <div className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-slate-50" title={`${i.name}: ${f.moneyText(i.value)} (${share.toFixed(1)}%)`}>
            <span className="truncate text-sm text-slate-700">{i.name}</span>
            <span className="h-2.5 overflow-hidden rounded-full">
              <span className="block h-full rounded-e-[4px] transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(pct, 1.5)}%`, background: CHART.series1 }} />
            </span>
            <span className="text-sm font-semibold text-slate-800">{f.money(i.value, { symbol: false })}</span>
          </div>
        )
        return <li key={i.key}>{i.href ? <a href={i.href}>{body}</a> : body}</li>
      })}
    </ul>
  )
}

/** مقياس نسبة لكل صف: المسار درجة أفتح من نفس التدرج، والتعبئة باللون الأساسي، والنسبة نصًا. */
export function MeterList({ items, emptyText }: { items: { key: string; name: string; value: string; total: string; hint?: string }[]; emptyText: string }) {
  const f = useFormat()
  if (items.length === 0) return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const rate = D(i.total).isZero() ? 0 : Math.min(100, D(i.value).dividedBy(D(i.total)).times(100).toNumber())
        return (
          <li key={i.key} title={`${i.name}: ${rate.toFixed(1)}% — ${f.moneyText(i.value)} من ${f.moneyText(i.total)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-700">
                {i.name}
                {i.hint ? <span className="ms-2 text-xs text-slate-400">{i.hint}</span> : null}
              </span>
              <span className="font-semibold text-slate-800">{rate.toFixed(0)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: CHART.track }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rate)} aria-label={i.name}>
              <div className="h-full rounded-full" style={{ width: `${rate}%`, background: CHART.series1 }} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              المحصل {f.money(i.value, { symbol: false })} من {f.money(i.total)}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
