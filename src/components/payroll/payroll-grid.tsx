'use client'

import * as React from 'react'
import Link from 'next/link'
import { Loader2, Printer, Banknote, X, AlertCircle, Check } from 'lucide-react'
import { useApp, useCan, useFormat } from '@/components/providers/app-provider'
import { useAction } from '@/lib/use-action'
import { removeItemAction, updateItemAction } from '@/app/(app)/payroll/actions'
import { calcPayrollItem, type SalaryKind } from '@/lib/payroll-calc'
import { D, sum } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface GridItem {
  id: number
  employeeId: number
  employeeName: string
  employeeNumber: string
  jobTitle: string | null
  isTeacher: boolean
  salaryType: SalaryKind
  rate: string
  workDays: string
  workHours: string
  absenceDays: string
  lateHours: string
  overtimeHours: string
  overtimeAmount: string
  bonuses: string
  allowances: string
  otherDeductions: string
  withholdings: string
  plannedAdvance: string
  advanceDeduction: string
  basicPay: string
  grossPay: string
  totalDeductions: string
  netPay: string
  paidAmount: string
  paymentStatus: string
}

type Editable = 'workDays' | 'workHours' | 'absenceDays' | 'lateHours' | 'bonuses' | 'allowances' | 'otherDeductions' | 'withholdings'

const TYPE_SHORT: Record<SalaryKind, string> = { MONTHLY: 'شهري', DAILY: 'يومي', HOURLY: 'ساعة' }

export function PayrollGrid({ items, editable, cfg, runId }: { items: GridItem[]; editable: boolean; cfg: { workDaysPerMonth: number; hoursPerDay: number; decimals: number }; runId: number }) {
  const f = useFormat()
  const [previews, setPreviews] = React.useState<Record<number, ReturnType<typeof calcPayrollItem>>>({})
  const rows = items.map((it) => ({ it, calc: previews[it.id] }))
  const total = (k: 'grossPay' | 'totalDeductions' | 'netPay' | 'advanceDeduction') => sum(rows.map((r) => (r.calc ? r.calc[k] : r.it[k])))
  const onPreview = React.useCallback((id: number, c: ReturnType<typeof calcPayrollItem> | null) => {
    setPreviews((p) => {
      const next = { ...p }
      if (c) next[id] = c
      else delete next[id]
      return next
    })
  }, [])

  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2.5 text-start font-medium">الموظف</th>
            <th className="px-1.5 py-2.5 text-center font-medium">أيام/ساعات العمل</th>
            <th className="px-1.5 py-2.5 text-center font-medium">غياب (يوم)</th>
            <th className="px-1.5 py-2.5 text-center font-medium">تأخير (ساعة)</th>
            <th className="px-1.5 py-2.5 text-end font-medium">الإضافي</th>
            <th className="px-1.5 py-2.5 text-center font-medium">مكافآت</th>
            <th className="px-1.5 py-2.5 text-center font-medium">بدلات</th>
            <th className="px-1.5 py-2.5 text-center font-medium">خصومات</th>
            <th className="px-1.5 py-2.5 text-center font-medium">استقطاعات</th>
            <th className="px-1.5 py-2.5 text-end font-medium">قسط سلفة</th>
            <th className="px-1.5 py-2.5 text-end font-medium">الإجمالي</th>
            <th className="px-1.5 py-2.5 text-end font-medium">الخصومات</th>
            <th className="px-1.5 py-2.5 text-end font-semibold text-slate-700">الصافي</th>
            {!editable ? <th className="px-1.5 py-2.5 text-end font-medium">المصروف</th> : null}
            <th className="px-1.5 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <GridRow key={it.id} item={it} editable={editable} cfg={cfg} onPreview={onPreview} runId={runId} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
            <td className="px-3 py-2.5">الإجمالي ({items.length} موظف)</td>
            <td colSpan={3} />
            <td className="px-1.5 py-2.5 text-end">{f.money(sum(items.map((i) => i.overtimeAmount)), { symbol: false })}</td>
            <td colSpan={4} />
            <td className="px-1.5 py-2.5 text-end">{f.money(total('advanceDeduction'), { symbol: false })}</td>
            <td className="px-1.5 py-2.5 text-end">{f.money(total('grossPay'), { symbol: false })}</td>
            <td className="px-1.5 py-2.5 text-end">{f.money(total('totalDeductions'), { symbol: false })}</td>
            <td className="px-1.5 py-2.5 text-end text-brand-700">{f.money(total('netPay'))}</td>
            {!editable ? <td className="px-1.5 py-2.5 text-end">{f.money(sum(items.map((i) => i.paidAmount)), { symbol: false })}</td> : null}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function GridRow({
  item,
  editable,
  cfg,
  onPreview,
  runId,
}: {
  item: GridItem
  editable: boolean
  cfg: { workDaysPerMonth: number; hoursPerDay: number; decimals: number }
  onPreview: (id: number, c: ReturnType<typeof calcPayrollItem> | null) => void
  runId: number
}) {
  const f = useFormat()
  const can = useCan()
  const { today } = useApp()
  const initial = React.useMemo(
    () => ({
      workDays: item.workDays,
      workHours: item.workHours,
      absenceDays: item.absenceDays,
      lateHours: item.lateHours,
      bonuses: item.bonuses,
      allowances: item.allowances,
      otherDeductions: item.otherDeductions,
      withholdings: item.withholdings,
    }),
    [item],
  )
  const [v, setV] = React.useState<Record<Editable, string>>(initial)
  const [saved, setSaved] = React.useState(false)
  const dirty = (Object.keys(v) as Editable[]).some((k) => D(v[k] || 0).comparedTo(D(initial[k] || 0)) !== 0)
  const calc = React.useMemo(
    () =>
      calcPayrollItem(
        {
          salaryType: item.salaryType,
          rate: item.rate,
          ...v,
          overtimeAmount: item.overtimeAmount,
          plannedAdvance: item.plannedAdvance,
        },
        cfg,
      ),
    [v, item, cfg],
  )
  const save = useAction(updateItemAction, {
    refresh: true,
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    },
  })
  const remove = useAction(removeItemAction)

  React.useEffect(() => {
    onPreview(item.id, dirty ? calc : null)
  }, [dirty, calc, item.id, onPreview])

  const commit = () => {
    if (!dirty || calc.error) return
    save.run({ id: item.id, ...v })
  }
  const input = (k: Editable, width = 'w-16') =>
    editable ? (
      <input
        value={v[k]}
        onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value.replace(/[^\d.]/g, '') }))}
        onFocus={(e) => e.target.select()}
        inputMode="decimal"
        dir="ltr"
        className={cn(
          'num h-8 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          width,
          D(v[k] || 0).comparedTo(D(initial[k] || 0)) !== 0 && 'border-amber-400 bg-amber-50',
        )}
      />
    ) : (
      <span className="num">{D(v[k]).isZero() ? <span className="text-slate-300">—</span> : f.number(v[k], 2)}</span>
    )
  const shown = dirty ? calc : { ...item, error: null as string | null }
  const remaining = D(item.netPay).minus(D(item.paidAmount))

  return (
    <tr
      className={cn('border-t border-slate-100 align-middle hover:bg-slate-50/60', calc.error && 'bg-rose-50/60')}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
    >
      <td className="px-3 py-2">
        <Link href={`/employees/${item.employeeId}`} className="font-medium text-slate-900 hover:text-brand-700">
          {item.employeeName}
        </Link>
        <p className="text-xs text-slate-500">
          <span className="num">{item.employeeNumber}</span> · {f.amount(item.rate)} {TYPE_SHORT[item.salaryType]}
        </p>
      </td>
      <td className="px-1.5 py-2 text-center">{item.salaryType === 'HOURLY' ? input('workHours', 'w-14') : input('workDays', 'w-12')}</td>
      <td className="px-1.5 py-2 text-center">{input('absenceDays', 'w-12')}</td>
      <td className="px-1.5 py-2 text-center">{input('lateHours', 'w-12')}</td>
      <td className="px-1.5 py-2 text-end">
        {D(item.overtimeAmount).isZero() ? (
          <span className="text-slate-300">—</span>
        ) : (
          <>
            {f.money(item.overtimeAmount, { symbol: false })}
            <p className="text-[11px] text-slate-400">{f.number(item.overtimeHours, 2)} س</p>
          </>
        )}
      </td>
      <td className="px-1.5 py-2 text-center">{input('bonuses', 'w-16')}</td>
      <td className="px-1.5 py-2 text-center">{input('allowances', 'w-16')}</td>
      <td className="px-1.5 py-2 text-center">{input('otherDeductions', 'w-16')}</td>
      <td className="px-1.5 py-2 text-center">{input('withholdings', 'w-16')}</td>
      <td className="px-1.5 py-2 text-end">
        {D(shown.advanceDeduction).isZero() ? <span className="text-slate-300">—</span> : f.money(shown.advanceDeduction, { symbol: false })}
        {D(item.plannedAdvance).greaterThan(D(shown.advanceDeduction)) ? <p className="text-[11px] text-amber-600">خُفض من {f.amount(item.plannedAdvance)}</p> : null}
      </td>
      <td className="px-1.5 py-2 text-end">{f.money(shown.grossPay, { symbol: false })}</td>
      <td className="px-1.5 py-2 text-end text-rose-600">{f.money(shown.totalDeductions, { symbol: false, hideZero: true })}</td>
      <td className="px-1.5 py-2 text-end font-bold">{f.money(shown.netPay, { colored: true })}</td>
      {!editable ? (
        <td className="px-1.5 py-2 text-end">
          {f.money(item.paidAmount, { symbol: false, hideZero: true })}
          {remaining.greaterThan(0) && D(item.paidAmount).greaterThan(0) ? <p className="text-[11px] text-amber-600">باقي {f.amount(remaining)}</p> : null}
        </td>
      ) : null}
      <td className="px-1.5 py-2">
        <div className="flex items-center justify-end gap-1">
          {editable ? (
            <>
              {save.pending ? <Loader2 className="size-4 animate-spin text-slate-400" /> : saved ? <Check className="size-4 text-emerald-600" /> : null}
              {calc.error ? (
                <span title={calc.error}>
                  <AlertCircle className="size-4 text-rose-600" />
                </span>
              ) : null}
              {can('payroll.manage') ? (
                <button
                  type="button"
                  className="rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  title="استبعاد من المسودة"
                  onClick={() => {
                    if (confirm(`استبعاد ${item.employeeName} من هذه المسودة؟`)) remove.run(item.id)
                  }}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </>
          ) : (
            <>
              <Link href={`/print/payslips/${item.id}`} target="_blank" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700" title="قسيمة الراتب">
                <Printer className="size-4" />
              </Link>
              {remaining.greaterThan(0) && can('payroll.pay') && can('vouchers.create') ? (
                <Link
                  href={`/vouchers/new?kind=SALARY&payrollItemId=${item.id}&date=${today}&from=${runId}`}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-700"
                  title="صرف الراتب (أو جزء منه)"
                >
                  <Banknote className="size-4" />
                </Link>
              ) : null}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
