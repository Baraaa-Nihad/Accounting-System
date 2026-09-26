'use client'

import * as React from 'react'
import { DropdownMenu as M } from 'radix-ui'
import { cn } from '@/lib/utils'

export const Dropdown = M.Root
export const DropdownTrigger = M.Trigger

export function DropdownContent({
  children,
  align = 'end',
  className,
}: {
  children: React.ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
}) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl',
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function DropdownItem({
  children,
  onSelect,
  danger,
  disabled,
  asChild,
}: {
  children: React.ReactNode
  onSelect?: (e: Event) => void
  danger?: boolean
  disabled?: boolean
  asChild?: boolean
}) {
  return (
    <M.Item
      asChild={asChild}
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-slate-500',
        danger && 'text-rose-600 data-[highlighted]:bg-rose-50 [&_svg]:text-rose-500',
      )}
    >
      {children}
    </M.Item>
  )
}

export function DropdownSeparator() {
  return <M.Separator className="my-1 h-px bg-slate-100" />
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <M.Label className="px-2.5 py-1.5 text-xs font-medium text-slate-400">{children}</M.Label>
}
