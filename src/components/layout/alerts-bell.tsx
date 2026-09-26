'use client'

import Link from 'next/link'
import { Bell, AlertTriangle, AlertOctagon, Info } from 'lucide-react'
import { Popover } from 'radix-ui'
import { cn } from '@/lib/utils'

export interface AlertItem {
  id: string
  level: 'info' | 'warning' | 'danger'
  title: string
  description?: string
  href: string
}

const ICON = { info: Info, warning: AlertTriangle, danger: AlertOctagon }
const COLOR = {
  info: 'bg-sky-50 text-sky-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-rose-50 text-rose-600',
}

export function AlertsBell({ alerts }: { alerts: AlertItem[] }) {
  const urgent = alerts.filter((a) => a.level !== 'info').length
  return (
    <Popover.Root>
      <Popover.Trigger className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100" aria-label="التنبيهات">
        <Bell className="size-5" />
        {alerts.length > 0 ? (
          <span
            className={cn(
              'absolute -top-0.5 -left-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white',
              urgent > 0 ? 'bg-rose-500' : 'bg-sky-500',
            )}
          >
            {alerts.length}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          dir="rtl"
          align="end"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold text-slate-900">التنبيهات</p>
            <Link href="/notifications" className="text-sm text-brand-700 hover:underline">
              عرض الكل
            </Link>
          </div>
          <div className="scroll-thin max-h-[26rem] overflow-y-auto p-2">
            {alerts.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">لا توجد تنبيهات حاليًا 👍</p>
            ) : (
              alerts.map((a) => {
                const Icon = ICON[a.level]
                return (
                  <Popover.Close asChild key={a.id}>
                    <Link href={a.href} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', COLOR[a.level])}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{a.title}</span>
                        {a.description ? <span className="block text-xs text-slate-500">{a.description}</span> : null}
                      </span>
                    </Link>
                  </Popover.Close>
                )
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
