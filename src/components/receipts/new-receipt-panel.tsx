'use client'

import * as React from 'react'
import { GraduationCap, Users, TrendingUp, Handshake, Search } from 'lucide-react'
import { StudentPicker, type PickedStudent } from '@/components/forms/student-picker'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PaymentForm } from './payment-form'
import { OtherReceiptForm } from './other-receipt-form'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type Mode = 'student' | 'family' | 'revenue' | 'partner'

export function NewReceiptPanel({
  initialMode,
  initialStudent,
  revenueAccounts,
  partners,
  cashAccounts,
}: {
  initialMode: Mode
  initialStudent: PickedStudent | null
  revenueAccounts: { id: number; name: string; code: string }[]
  partners: { id: number; name: string }[]
  cashAccounts: { id: number; name: string; type: string; isDefault: boolean }[]
}) {
  const router = useRouter()
  const [mode, setMode] = React.useState<Mode>(initialMode)
  const [student, setStudent] = React.useState<PickedStudent | null>(initialStudent)
  const [guardian, setGuardian] = React.useState<{ id: number; name: string } | null>(null)
  const [gq, setGq] = React.useState('')
  const [gResults, setGResults] = React.useState<{ id: number; name: string; phone: string | null; students: { fullName: string }[] }[]>([])

  React.useEffect(() => {
    const q = gq.trim()
    if (!q) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/guardians/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setGResults((await res.json()).results)
    }, 250)
    return () => clearTimeout(t)
  }, [gq])

  const modes: { key: Mode; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'student', label: 'دفعة من طالب', desc: 'تسديد ذمم وأقساط طالب', icon: GraduationCap },
    { key: 'family', label: 'دفعة عائلية', desc: 'سند واحد لعدة إخوة', icon: Users },
    { key: 'revenue', label: 'إيراد آخر', desc: 'تبرعات وإيرادات متنوعة', icon: TrendingUp },
    { key: 'partner', label: 'رأس مال شريك', desc: 'إيداع من أحد الشركاء', icon: Handshake },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={cn(
              'card flex items-center gap-3 p-4 text-start transition-colors',
              mode === m.key ? 'border-brand-500 ring-2 ring-brand-500/20' : 'hover:bg-slate-50',
            )}
          >
            <span className={cn('flex size-10 items-center justify-center rounded-xl', mode === m.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
              <m.icon className="size-5" />
            </span>
            <span>
              <span className="block font-semibold text-slate-900">{m.label}</span>
              <span className="block text-xs text-slate-500">{m.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="card p-5 sm:p-6">
        {mode === 'student' ? (
          <div className="space-y-5">
            <Field label="الطالب" required>
              <StudentPicker value={student} onChange={setStudent} autoFocus />
            </Field>
            {student ? <PaymentForm key={student.id} studentId={student.id} onClose={() => router.push('/receipts')} /> : null}
          </div>
        ) : null}
        {mode === 'family' ? (
          <div className="space-y-5">
            {guardian ? (
              <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
                <span className="font-semibold">عائلة: {guardian.name}</span>
                <button type="button" className="text-sm text-brand-700" onClick={() => setGuardian(null)}>
                  تغيير
                </button>
              </div>
            ) : (
              <Field label="ولي الأمر">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input value={gq} onChange={(e) => setGq(e.target.value)} placeholder="اسم ولي الأمر أو هاتفه" className="pr-9" autoFocus />
                </div>
                <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {(gq.trim() ? gResults : []).map((g) => (
                    <button key={g.id} type="button" onClick={() => setGuardian(g)} className="flex w-full items-center justify-between px-4 py-2.5 text-start hover:bg-slate-50">
                      <span>
                        <span className="block font-medium">{g.name}</span>
                        <span className="block text-xs text-slate-500">{g.students.map((s) => s.fullName).join('، ')}</span>
                      </span>
                      <bdi className="ltr num text-sm text-slate-500">{g.phone}</bdi>
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {guardian ? <PaymentForm key={guardian.id} guardianId={guardian.id} onClose={() => router.push('/receipts')} /> : null}
          </div>
        ) : null}
        {mode === 'revenue' ? <OtherReceiptForm kind="OTHER_REVENUE" revenueAccounts={revenueAccounts} partners={partners} cashAccounts={cashAccounts} /> : null}
        {mode === 'partner' ? (
          partners.length ? (
            <OtherReceiptForm kind="PARTNER_CAPITAL" revenueAccounts={revenueAccounts} partners={partners} cashAccounts={cashAccounts} />
          ) : (
            <p className="text-slate-500">لا يوجد شركاء مسجلون. أضف الشركاء من «المستخدمون والصلاحيات ← الشركاء».</p>
          )
        ) : null}
      </div>
    </div>
  )
}
