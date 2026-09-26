import Link from 'next/link'
import { BookOpen, ChevronLeft, FileStack, FolderTree, Landmark, Scale, ShieldCheck, TrendingUp, BookMarked } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { balanceSheet, incomeStatement, trialBalance } from '@/server/services/financial-statements'
import { defaultRange } from '@/server/services/accounting'
import { getFormatConfig, today as todayOf } from '@/server/settings'
import { getCurrentYear } from '@/server/years'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { AccountingTabs } from '@/components/accounting/accounting-tabs'

export const metadata = { title: 'المحاسبة العامة' }

const LINKS = [
  { href: '/accounting/accounts', title: 'دليل الحسابات', text: 'شجرة الحسابات بأرصدتها، وإضافة حسابات جديدة.', icon: FolderTree },
  { href: '/accounting/journal', title: 'القيود اليومية', text: 'كل القيود الآلية واليدوية مع مستنداتها، والقيود اليدوية للتسويات.', icon: FileStack },
  { href: '/accounting/ledger', title: 'دفتر الأستاذ', text: 'حركات أي حساب مع الرصيد التراكمي لأي فترة.', icon: BookOpen },
  { href: '/accounting/trial-balance', title: 'ميزان المراجعة', text: 'أرصدة كل الحسابات مع التحقق من التوازن.', icon: Scale },
  { href: '/accounting/income-statement', title: 'قائمة الدخل', text: 'الإيرادات والخصومات والمصروفات وصافي الربح وحصص الشركاء.', icon: TrendingUp },
  { href: '/accounting/balance-sheet', title: 'الميزانية العمومية', text: 'الأصول والالتزامات وحقوق الملكية في تاريخ.', icon: Landmark },
  { href: '/accounting/integrity', title: 'فحص سلامة البيانات', text: 'مطابقة أرصدة الطلاب والموظفين والموردين والسندات مع الدفاتر.', icon: ShieldCheck },
]

export default async function AccountingPage() {
  const user = await requirePermission('accounting.view')
  const [fmt, today, year] = await Promise.all([getFormatConfig(), todayOf(), getCurrentYear(db)])
  const range = defaultRange(year, today)
  const [bs, is, tb, recent] = await Promise.all([
    balanceSheet(db, { asOf: today }),
    incomeStatement(db, range),
    trialBalance(db, { to: today }),
    db.journalEntry.findMany({ where: { sourceType: 'MANUAL' }, orderBy: { id: 'desc' }, take: 5, include: { createdBy: { select: { fullName: true } } } }),
  ])
  const f = makeFormatters(fmt)
  return (
    <>
      <PageHeader
        title="المحاسبة العامة"
        description="كل مستند في النظام (ذمة، سند، راتب، تحويل) يُنشئ قيدًا مزدوجًا تلقائيًا، فتبقى الدفاتر والقوائم المالية مطابقة للشاشات البسيطة."
        actions={
          can(user, 'accounting.manage') ? (
            <Link href="/accounting/journal/new" className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-medium text-white hover:bg-brand-700">
              <BookMarked className="size-5" />
              قيد يدوي جديد
            </Link>
          ) : null
        }
      />
      <AccountingTabs active="overview" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="إجمالي الأصول (اليوم)" value={f.money(bs.assets.total.toString())} />
        <StatCard label="الالتزامات" value={f.money(bs.liabilities.total.toString())} accent="amber" />
        <StatCard label="حقوق الملكية مع الأرباح غير المقفلة" value={f.money(bs.equity.total.plus(bs.unclosedIncome).toString())} accent="green" />
        <StatCard
          label={`صافي ${is.netIncome.isNegative() ? 'الخسارة' : 'الربح'} منذ بداية السنة`}
          value={f.money(is.netIncome.abs().toString())}
          accent={is.netIncome.isNegative() ? 'red' : 'green'}
        />
      </div>
      <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-600">
        ميزان المراجعة: {tb.balanced ? <Badge tone="green">متوازن ✓</Badge> : <Badge tone="red">غير متوازن ✗</Badge>}
        <span className="text-slate-300">·</span>
        الميزانية: {bs.balanced ? <Badge tone="green">متوازنة ✓</Badge> : <Badge tone="red">غير متوازنة ✗</Badge>}
      </p>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="card group flex items-start gap-3 p-4 transition-shadow hover:shadow-md">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <l.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">{l.title}</span>
              <span className="mt-0.5 block text-sm text-slate-500">{l.text}</span>
            </span>
            <ChevronLeft className="mt-2 size-4 text-slate-300 group-hover:text-brand-600" />
          </Link>
        ))}
      </div>
      {recent.length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-semibold text-slate-900">آخر القيود اليدوية</h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <Link href={`/accounting/journal/${e.id}`} className="num font-medium text-brand-700 hover:underline">
                  {e.number}
                </Link>
                <span className="text-slate-500">{f.date(e.date)}</span>
                <span className="min-w-0 flex-1 text-slate-700">{e.description}</span>
                {f.money(e.totalAmount)}
                {e.status === 'REVERSED' ? <Badge tone="gray">معكوس</Badge> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
