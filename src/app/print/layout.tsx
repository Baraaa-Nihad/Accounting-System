import { requireUser } from '@/server/auth/guard'
import { getSettings } from '@/server/settings'
import { AppProvider } from '@/components/providers/app-provider'
import { todayInTimeZone } from '@/lib/dates'

/** تخطيط صفحات الطباعة: بدون قائمة جانبية، بخلفية بيضاء. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const settings = await getSettings()
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
        currentYear: null,
        selectedYear: null,
        years: [],
        today: todayInTimeZone(settings.finance.timezone),
        schoolName: settings.school.name,
      }}
    >
      <div className="min-h-dvh bg-slate-100 print:bg-white">{children}</div>
    </AppProvider>
  )
}
