import * as React from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-[15px] text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-rose-400 aria-[invalid=true]:ring-rose-500/15'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(inputClass, className)} {...props} />,
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(inputClass, 'h-auto py-2 leading-relaxed', className)} {...props} />
  ),
)
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        inputClass,
        'appearance-none bg-[length:1.1em] bg-[position:left_0.75rem_center] bg-no-repeat pe-3 ps-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

export function Checkbox({
  label,
  className,
  description,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-start gap-2.5 select-none', className)}>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-600"
        {...props}
      />
      {label ? (
        <span className="flex flex-col">
          <span className="text-[15px] text-slate-800">{label}</span>
          {description ? <span className="text-xs text-slate-500">{description}</span> : null}
        </span>
      ) : null}
    </label>
  )
}
