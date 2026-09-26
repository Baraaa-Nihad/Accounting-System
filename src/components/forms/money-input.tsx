'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { inputClass } from '@/components/ui/input'
import { parseAmountInput } from '@/lib/money'
import { useApp } from '@/components/providers/app-provider'

/**
 * حقل مبلغ: يقبل الأرقام العربية والفواصل، ويعرض الفواصل عند الخروج من الحقل.
 * القيمة المرسلة نص رقمي نظيف (مثل "1500.5").
 */
export function MoneyInput({
  value,
  onChange,
  className,
  placeholder = '0.00',
  showSymbol = true,
  large,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
  showSymbol?: boolean
  large?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const { format } = useApp()
  const [focused, setFocused] = React.useState(false)
  const display = React.useMemo(() => {
    if (focused || value === '') return value
    const d = parseAmountInput(value)
    if (!d) return value
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: format.decimals }).format(
      d.toFixed(format.decimals) as unknown as number,
    )
  }, [value, focused, format.decimals])

  return (
    <div className="relative">
      <input
        {...props}
        inputMode="decimal"
        dir="ltr"
        value={display}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocused(true)
          props.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          const d = parseAmountInput(value)
          if (d) onChange(d.toDecimalPlaces(format.decimals).toString())
          props.onBlur?.(e)
        }}
        onChange={(e) => {
          const raw = e.target.value
            .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
            .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
            .replace(/٫/g, '.')
            .replace(/[^\d.,]/g, '')
          onChange(raw.replace(/,/g, ''))
        }}
        className={cn(inputClass, 'num text-left', showSymbol && 'pr-10', large && 'h-14 text-2xl font-bold', className)}
      />
      {showSymbol ? (
        <span className={cn('pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400', large ? 'text-lg' : 'text-sm')}>
          {format.currencySymbol}
        </span>
      ) : null}
    </div>
  )
}
