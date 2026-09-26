'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  GraduationCap,
  FileText,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Wallet,
  Hammer,
  Truck,
  Receipt,
  TrendingUp,
  Landmark,
  BarChart3,
  FileSpreadsheet,
  ShieldCheck,
  Settings,
  BookOpen,
  History,
  type LucideIcon,
} from 'lucide-react'
import { NAV_ITEMS } from '@/lib/nav'
import { useApp } from '@/components/providers/app-provider'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  home: LayoutDashboard,
  students: GraduationCap,
  charges: FileText,
  receipts: ArrowDownToLine,
  vouchers: ArrowUpFromLine,
  employees: Users,
  payroll: Wallet,
  contractors: Hammer,
  suppliers: Truck,
  expenses: Receipt,
  revenues: TrendingUp,
  treasury: Landmark,
  reports: BarChart3,
  import: FileSpreadsheet,
  users: ShieldCheck,
  settings: Settings,
  accounting: BookOpen,
  audit: History,
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { permissions } = useApp()
  const items = NAV_ITEMS.filter((i) => i.permissions.some((p) => permissions.includes(p)))
  return (
    <nav className="flex flex-col gap-0.5 px-3 py-3">
      {items.map((item, index) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard
        const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`)
        const showSection = !!item.section && item.section !== items[index - 1]?.section
        return (
          <div key={item.href}>
            {showSection ? <p className="mb-1 mt-4 px-3 text-xs font-medium text-slate-400">{item.section}</p> : null}
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors',
                active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon className={cn('size-5 shrink-0', active ? 'text-white' : 'text-slate-400')} />
              <span className="truncate">{item.label}</span>
            </Link>
          </div>
        )
      })}
    </nav>
  )
}

export function SidebarBrand() {
  const { schoolName } = useApp()
  return (
    <Link href="/" className="flex items-center gap-3 px-5 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
        م
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-bold text-slate-900">{schoolName}</p>
        <p className="text-xs text-slate-500">النظام المالي</p>
      </div>
    </Link>
  )
}
