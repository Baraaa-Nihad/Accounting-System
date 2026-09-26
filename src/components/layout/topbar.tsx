'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu, LogOut, KeyRound, UserRound, CalendarRange, ChevronDown, Search } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { useApp } from '@/components/providers/app-provider'
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown'
import { SidebarBrand, SidebarNav } from './sidebar'
import { selectYearAction } from '@/app/(app)/layout-actions'
import { logoutAction } from '@/app/login/actions'
import { cn } from '@/lib/utils'

export function Topbar({ searchSlot, alertsSlot }: { searchSlot?: React.ReactNode; alertsSlot?: React.ReactNode }) {
  const { user, selectedYear, years } = useApp()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [, startTransition] = React.useTransition()

  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur lg:px-6">
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Trigger className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="القائمة">
          <Menu className="size-6" />
        </D.Trigger>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <D.Content dir="rtl" className="scroll-thin fixed inset-y-0 right-0 z-50 w-72 overflow-y-auto bg-white shadow-2xl lg:hidden">
            <D.Title className="sr-only">القائمة الرئيسية</D.Title>
            <D.Description className="sr-only">روابط أقسام النظام</D.Description>
            <SidebarBrand />
            <SidebarNav onNavigate={() => setOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="min-w-0 flex-1">{searchSlot ?? <div className="hidden items-center gap-2 text-slate-400 sm:flex"><Search className="size-4" /></div>}</div>

      {years.length > 0 ? (
        <Dropdown>
          <DropdownTrigger className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <CalendarRange className="size-4 text-brand-600" />
            <span className="hidden sm:inline">السنة:</span>
            <bdi className="ltr num">{selectedYear?.name ?? '—'}</bdi>
            <ChevronDown className="size-4 text-slate-400" />
          </DropdownTrigger>
          <DropdownContent>
            <DropdownLabel>السنة الدراسية المعروضة</DropdownLabel>
            {years.map((y) => (
              <DropdownItem
                key={y.id}
                onSelect={() =>
                  startTransition(async () => {
                    await selectYearAction(y.id)
                    router.refresh()
                  })
                }
              >
                <span className={cn('flex-1', selectedYear?.id === y.id && 'font-semibold text-brand-700')}>
                  <bdi className="ltr num">{y.name}</bdi>
                </span>
                {y.isCurrent ? <span className="text-xs text-brand-600">الحالية</span> : null}
                {y.status === 'CLOSED' ? <span className="text-xs text-slate-400">مغلقة</span> : null}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
      ) : null}

      {alertsSlot}

      <Dropdown>
        <DropdownTrigger className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-100">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {user?.fullName?.trim()?.[0] ?? '؟'}
          </span>
          <span className="hidden text-start md:block">
            <span className="block text-sm font-semibold leading-tight text-slate-800">{user?.fullName}</span>
            <span className="block text-xs text-slate-500">{user?.roleName}</span>
          </span>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem asChild>
            <Link href="/profile">
              <UserRound />
              حسابي
            </Link>
          </DropdownItem>
          <DropdownItem asChild>
            <Link href="/change-password">
              <KeyRound />
              تغيير كلمة المرور
            </Link>
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem danger onSelect={() => startTransition(() => logoutAction())}>
            <LogOut />
            تسجيل الخروج
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </header>
  )
}
