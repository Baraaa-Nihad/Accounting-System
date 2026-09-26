import * as React from 'react'
import { cn } from '@/lib/utils'

export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('scroll-thin overflow-x-auto', className)}>{children}</div>
}

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-slate-50/80 text-slate-500">{children}</thead>
}

export function TH({
  children,
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-slate-200 px-4 py-2.5 text-start text-xs font-semibold',
        numeric && 'text-end',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function TR({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-slate-100 last:border-0 hover:bg-slate-50/60', className)} {...props}>
      {children}
    </tr>
  )
}

export function TD({
  children,
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn('px-4 py-2.5 align-middle', numeric && 'num whitespace-nowrap text-end', className)} {...props}>
      {children}
    </td>
  )
}

export function TFootRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">{children}</tr>
}
