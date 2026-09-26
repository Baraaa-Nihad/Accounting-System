import { requireUser } from '@/server/auth/guard'
import { getSettings, today } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { getCurrentYear, listYears } from '@/server/years'
import { AppProvider } from '@/components/providers/app-provider'
import { SidebarBrand, SidebarNav } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { GlobalSearch } from '@/components/layout/global-search'
import { AlertsBell } from '@/components/layout/alerts-bell'
import { getAlerts } from '@/server/services/alerts'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [settings, selectedYear, currentYear, years, todayStr] = await Promise.all([
    getSettings(),
    getSelectedYear(),
    getCurrentYear(),
    listYears(),
    today(),
  ])
  const alerts = user.permissions.has('dashboard.view') ? await getAlerts(user) : []
  return (
    <AppProvider
      value={{
        format: {
          currencySymbol: settings.finance.currencySymbol,
          currencyCode: settings.finance.currencyCode,
          decimals: settings.finance.decimals,
          dateFormat: settings.finance.dateFormat,
          timezone: settings.finance.timezone,
        },
        user: { id: user.id, fullName: user.fullName, username: user.username, roleName: user.roleName },
        permissions: Array.from(user.permissions),
        currentYear: currentYear ? { id: currentYear.id, name: currentYear.name } : null,
        selectedYear: selectedYear ? { id: selectedYear.id, name: selectedYear.name } : null,
        years: years.map((y) => ({ id: y.id, name: y.name, status: y.status, isCurrent: y.isCurrent })),
        today: todayStr,
        schoolName: settings.school.name,
      }}
    >
      <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="no-print scroll-thin sticky top-0 hidden h-dvh overflow-y-auto border-e border-slate-200/80 bg-white lg:block">
          <SidebarBrand />
          <SidebarNav />
        </aside>
        <div className="flex min-w-0 flex-col">
          <Topbar searchSlot={<GlobalSearch />} alertsSlot={<AlertsBell alerts={alerts} />} />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </AppProvider>
  )
}
