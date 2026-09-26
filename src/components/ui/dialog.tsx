'use client'

import * as React from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  title,
  description,
  children,
  className,
  size = 'md',
  footer,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  footer?: React.ReactNode
}) {
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl' }
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <D.Content
        dir="rtl"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-2xl focus:outline-none',
          widths[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <D.Title className="text-lg font-semibold text-slate-900">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-slate-500">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === 'string' ? title : ''}</D.Description>
            )}
          </div>
          <D.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
            {footer}
          </div>
        ) : null}
      </D.Content>
    </D.Portal>
  )
}
