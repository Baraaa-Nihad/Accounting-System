import Link from 'next/link'
import { cn } from '@/lib/utils'

export const SETTINGS_SECTIONS = [
  { href: '/settings?tab=school', key: 'school', label: 'بيانات المدرسة' },
  { href: '/settings?tab=finance', key: 'finance', label: 'العملة والتاريخ' },
  { href: '/settings/years', key: 'years', label: 'السنوات الدراسية' },
  { href: '/settings/grades', key: 'grades', label: 'المراحل والصفوف والشعب' },
  { href: '/settings/charge-types', key: 'charge-types', label: 'تصنيفات الذمم' },
  { href: '/settings/discount-types', key: 'discount-types', label: 'أنواع الخصم' },
  { href: '/settings?tab=numbering', key: 'numbering', label: 'ترقيم السندات' },
  { href: '/settings?tab=print', key: 'print', label: 'الطباعة' },
  { href: '/settings?tab=payroll', key: 'payroll', label: 'الرواتب' },
  { href: '/settings?tab=security', key: 'security', label: 'الأمان' },
  { href: '/settings/backups', key: 'backups', label: 'النسخ الاحتياطي' },
]

export function SettingsLayout({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <nav className="card h-fit p-2 lg:sticky lg:top-20">
        {SETTINGS_SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className={cn(
              'block rounded-xl px-3 py-2 text-sm font-medium',
              s.key === active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
