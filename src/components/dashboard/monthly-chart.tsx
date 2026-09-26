'use client'

import * as React from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { Table2, BarChart3 } from 'lucide-react'
import { useFormat } from '@/components/providers/app-provider'
import { ARABIC_MONTHS } from '@/lib/dates'
import { D } from '@/lib/money'
import { CHART } from './chart-tokens'

export interface MonthlyPoint {
  key: string
  year: number
  month: number
  collections: string
  expenses: string
}

const SERIES = [
  { key: 'collections', label: 'التحصيل من الطلاب', color: CHART.series1 },
  { key: 'expenses', label: 'المصروفات', color: CHART.series2 },
] as const

function compact(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`
  if (abs >= 10_000) return `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** التحصيل مقابل المصروفات لكل شهر: أعمدة مجمعة، محور واحد، مع عرض جدول بديل. */
export function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const f = useFormat()
  const [table, setTable] = React.useState(false)
  const rows = data.map((d) => ({
    ...d,
    label: ARABIC_MONTHS[d.month - 1],
    collectionsN: D(d.collections).toNumber(),
    expensesN: D(d.expenses).toNumber(),
  }))
  const empty = rows.every((r) => r.collectionsN === 0 && r.expensesN === 0)

  const TooltipBody = ({ active, payload }: TooltipContentProps<number, string>) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload as (typeof rows)[number]
    return (
      <div className="min-w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg" dir="rtl">
        <p className="mb-1 text-xs text-slate-500">
          {p.label} <span className="num">{p.year}</span>
        </p>
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
            <b className="text-slate-900">{f.money(p[s.key])}</b>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 text-xs text-slate-500">
          <span>الفرق</span>
          <span className="text-slate-800">{f.money(D(p.collections).minus(D(p.expenses)))}</span>
        </div>
      </div>
    )
  }

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600" aria-label="مفتاح الرسم">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-pressed={table}
        >
          {table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
          {table ? 'عرض كرسم' : 'عرض كجدول'}
        </button>
      </div>
      {empty ? (
        <p className="flex h-[280px] items-center justify-center text-sm text-slate-500">لا توجد حركات في هذه السنة بعد</p>
      ) : table ? (
        <div className="max-h-[280px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs text-slate-500">
              <tr>
                <th className="py-1.5 text-start font-medium">الشهر</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 text-end font-medium">
                    {s.label}
                  </th>
                ))}
                <th className="py-1.5 text-end font-medium">الفرق</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="py-1.5">
                    {r.label} <span className="num text-slate-400">{r.year}</span>
                  </td>
                  <td className="py-1.5 text-end">{f.money(r.collections, { hideZero: true })}</td>
                  <td className="py-1.5 text-end">{f.money(r.expenses, { hideZero: true })}</td>
                  <td className="py-1.5 text-end">{f.money(D(r.collections).minus(D(r.expenses)), { colored: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-[280px]" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={2} barCategoryGap="30%" margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: CHART.baseline }} tick={{ fill: CHART.tick, fontSize: 12 }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis orientation="right" tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: CHART.tick, fontSize: 12 }} width={52} />
              <Tooltip content={(props) => <TooltipBody {...(props as TooltipContentProps<number, string>)} />} cursor={{ fill: CHART.hover }} />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={`${s.key}N`} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <figcaption className="sr-only">التحصيل من الطلاب مقابل المصروفات لكل شهر من السنة الدراسية</figcaption>
    </figure>
  )
}
