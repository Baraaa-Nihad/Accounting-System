'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Save, Users, AlertTriangle, Link2, UserPlus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, Checkbox } from '@/components/ui/input'
import { Field, FormSection } from '@/components/ui/field'
import { useAction } from '@/lib/use-action'
import { useApp, useCan, useFormat } from '@/components/providers/app-provider'
import { createStudentAction, updateStudentAction } from '@/app/(app)/students/actions'
import { cn } from '@/lib/utils'

export interface GradeOption {
  id: number
  name: string
  sections: { id: number; name: string }[]
}

export interface FeePlanOption {
  academicYearId: number
  gradeId: number
  chargeTypeName: string
  amount: string
  installmentsCount: number
}

interface GuardianMatch {
  id: number
  name: string
  phone: string | null
  students: { id: number; fullName: string }[]
}

export interface StudentFormValues {
  fullName: string
  schoolNumber: string
  gender: string
  birthDate: string
  nationalId: string
  joinDate: string
  address: string
  notes: string
  academicYearId: string
  gradeId: string
  sectionId: string
  guardianId: number | null
  guardianLabel: string
  guardian: { name: string; phone: string; phone2: string; relation: string; nationalId: string }
}

export function StudentForm({
  mode,
  studentId,
  initial,
  grades,
  years,
  feePlans,
}: {
  mode: 'create' | 'edit'
  studentId?: number
  initial: StudentFormValues
  grades: GradeOption[]
  years: { id: number; name: string; status: string }[]
  feePlans: FeePlanOption[]
}) {
  const router = useRouter()
  const can = useCan()
  const f = useFormat()
  const { format } = useApp()
  const [v, setV] = React.useState(initial)
  const [guardianMode, setGuardianMode] = React.useState<'new' | 'existing'>(initial.guardianId ? 'existing' : 'new')
  const [match, setMatch] = React.useState<GuardianMatch | null>(null)
  const [applyFees, setApplyFees] = React.useState(mode === 'create' && can('charges.create'))
  const [duplicate, setDuplicate] = React.useState<string | null>(null)
  const [guardianQuery, setGuardianQuery] = React.useState('')
  const [guardianResults, setGuardianResults] = React.useState<GuardianMatch[]>([])

  const createAction = useAction(createStudentAction, {
    onSuccess: (d) => router.push(`/students/${d.id}`),
  })
  const updateAction = useAction(
    React.useCallback((input: unknown) => updateStudentAction(studentId!, input), [studentId]),
    { onSuccess: () => router.push(`/students/${studentId}`) },
  )
  const { run, pending, fieldErrors } = mode === 'create' ? createAction : updateAction

  const set = <K extends keyof StudentFormValues>(k: K, val: StudentFormValues[K]) => setV((p) => ({ ...p, [k]: val }))
  const setG = (k: keyof StudentFormValues['guardian'], val: string) => setV((p) => ({ ...p, guardian: { ...p.guardian, [k]: val } }))

  const grade = grades.find((g) => String(g.id) === v.gradeId)
  const plans = feePlans.filter((p) => String(p.gradeId) === v.gradeId && String(p.academicYearId) === v.academicYearId)

  async function checkPhone() {
    const phone = v.guardian.phone.trim()
    if (phone.replace(/\D/g, '').length < 7) return setMatch(null)
    const res = await fetch(`/api/guardians/search?phone=${encodeURIComponent(phone)}`)
    if (res.ok) setMatch((await res.json()).match)
  }

  React.useEffect(() => {
    const q = guardianQuery.trim()
    if (!q) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/guardians/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setGuardianResults((await res.json()).results)
    }, 250)
    return () => clearTimeout(t)
  }, [guardianQuery])

  function submit(confirmDuplicate = false) {
    setDuplicate(null)
    const payload = {
      fullName: v.fullName,
      schoolNumber: v.schoolNumber,
      gender: v.gender,
      birthDate: v.birthDate,
      nationalId: v.nationalId,
      joinDate: v.joinDate,
      address: v.address,
      notes: v.notes,
      academicYearId: v.academicYearId,
      gradeId: v.gradeId,
      sectionId: v.sectionId,
      guardianId: guardianMode === 'existing' ? v.guardianId : null,
      guardian: guardianMode === 'new' ? v.guardian : null,
      applyFeePlans: mode === 'create' ? applyFees && plans.length > 0 : false,
      confirmDuplicate,
    }
    run(payload).then((r) => {
      if (!r.ok && r.fieldErrors?._duplicate) setDuplicate(r.error)
    })
  }

  return (
    <form
      className="grid gap-5 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
    >
      <div className="space-y-5 lg:col-span-2">
        <FormSection title="بيانات الطالب">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الطالب الكامل" required error={fieldErrors.fullName} className="sm:col-span-2">
              <Input value={v.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="الاسم الرباعي" autoFocus={mode === 'create'} />
            </Field>
            <Field label="الرقم المدرسي" hint="رقم الطالب في الوزارة أو السجل المدرسي (اختياري)" error={fieldErrors.schoolNumber}>
              <Input value={v.schoolNumber} onChange={(e) => set('schoolNumber', e.target.value)} dir="ltr" className="text-start" />
            </Field>
            <Field label="الجنس">
              <Select value={v.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="">—</option>
                <option value="MALE">ذكر</option>
                <option value="FEMALE">أنثى</option>
              </Select>
            </Field>
            <Field label="تاريخ الميلاد" error={fieldErrors.birthDate}>
              <Input type="date" value={v.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
            </Field>
            <Field label="الرقم الوطني / الهوية">
              <Input value={v.nationalId} onChange={(e) => set('nationalId', e.target.value)} dir="ltr" className="text-start" />
            </Field>
            <Field label="تاريخ الالتحاق بالمدرسة">
              <Input type="date" value={v.joinDate} onChange={(e) => set('joinDate', e.target.value)} />
            </Field>
            <Field label="العنوان">
              <Input value={v.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="ولي الأمر" description="الإخوة يُربطون بنفس ولي الأمر ليظهروا في حساب عائلة واحد.">
          <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
            {(['new', 'existing'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setGuardianMode(m)}
                className={cn('rounded-lg px-4 py-1.5 text-sm font-medium', guardianMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
              >
                {m === 'new' ? 'ولي أمر جديد' : 'ولي أمر مسجل مسبقًا'}
              </button>
            ))}
          </div>

          {guardianMode === 'new' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم ولي الأمر" required error={fieldErrors['guardian.name']}>
                <Input value={v.guardian.name} onChange={(e) => setG('name', e.target.value)} />
              </Field>
              <Field label="رقم الهاتف" required error={fieldErrors['guardian.phone']} hint="سيتم البحث تلقائيًا عن إخوة مسجلين بنفس الرقم">
                <Input value={v.guardian.phone} onChange={(e) => setG('phone', e.target.value)} onBlur={checkPhone} dir="ltr" className="text-start" inputMode="tel" />
              </Field>
              {match ? (
                <div className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 sm:col-span-2 sm:flex-row sm:items-center">
                  <Users className="size-5 shrink-0 text-sky-600" />
                  <div className="flex-1 text-sm text-sky-900">
                    هذا الرقم مسجل لولي الأمر <b>{match.name}</b>
                    {match.students.length ? <> — الأبناء: {match.students.map((s) => s.fullName).join('، ')}</> : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      setV((p) => ({ ...p, guardianId: match.id, guardianLabel: `${match.name}${match.phone ? ` · ${match.phone}` : ''}` }))
                      setGuardianMode('existing')
                    }}
                  >
                    <Link2 />
                    ربط بنفس العائلة
                  </Button>
                </div>
              ) : null}
              <Field label="هاتف إضافي">
                <Input value={v.guardian.phone2} onChange={(e) => setG('phone2', e.target.value)} dir="ltr" className="text-start" inputMode="tel" />
              </Field>
              <Field label="صلة القرابة">
                <Select value={v.guardian.relation} onChange={(e) => setG('relation', e.target.value)}>
                  <option value="">—</option>
                  <option value="الأب">الأب</option>
                  <option value="الأم">الأم</option>
                  <option value="الأخ">الأخ</option>
                  <option value="الجد">الجد</option>
                  <option value="أخرى">أخرى</option>
                </Select>
              </Field>
              <Field label="رقم هوية ولي الأمر">
                <Input value={v.guardian.nationalId} onChange={(e) => setG('nationalId', e.target.value)} dir="ltr" className="text-start" />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              {v.guardianId ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
                  <span className="font-medium text-slate-900">{v.guardianLabel}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setV((p) => ({ ...p, guardianId: null, guardianLabel: '' }))}>
                    تغيير
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input value={guardianQuery} onChange={(e) => setGuardianQuery(e.target.value)} placeholder="ابحث باسم ولي الأمر أو هاتفه" className="pr-9" />
                  </div>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {(guardianQuery.trim() ? guardianResults : []).map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-start hover:bg-slate-50"
                        onClick={() => setV((p) => ({ ...p, guardianId: g.id, guardianLabel: `${g.name}${g.phone ? ` · ${g.phone}` : ''}` }))}
                      >
                        <span>
                          <span className="block font-medium">{g.name}</span>
                          <span className="block text-xs text-slate-500">{g.students.map((s) => s.fullName).join('، ') || 'لا أبناء بعد'}</span>
                        </span>
                        <span className="text-sm text-slate-500" dir="ltr">
                          {g.phone}
                        </span>
                      </button>
                    ))}
                    {guardianQuery.trim() && guardianResults.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">لا نتائج</p> : null}
                  </div>
                </>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="ملاحظات">
          <Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={3} placeholder="أي معلومات إضافية" />
        </FormSection>
      </div>

      <div className="space-y-5">
        <FormSection title="الصف والسنة الدراسية">
          <div className="space-y-4">
            <Field label="السنة الدراسية" required error={fieldErrors.academicYearId}>
              <Select value={v.academicYearId} onChange={(e) => set('academicYearId', e.target.value)} disabled={mode === 'edit'}>
                {years.map((y) => (
                  <option key={y.id} value={y.id} disabled={y.status === 'CLOSED'}>
                    {y.name}
                    {y.status === 'CLOSED' ? ' (مغلقة)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الصف" required error={fieldErrors.gradeId}>
              <Select
                value={v.gradeId}
                onChange={(e) => setV((p) => ({ ...p, gradeId: e.target.value, sectionId: '' }))}
                aria-invalid={!!fieldErrors.gradeId}
              >
                <option value="">اختر الصف</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الشعبة" error={fieldErrors.sectionId}>
              <Select value={v.sectionId} onChange={(e) => set('sectionId', e.target.value)} disabled={!grade}>
                <option value="">—</option>
                {grade?.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        {mode === 'create' && can('charges.create') ? (
          <FormSection title="الرسوم المقررة" description="تُضاف الذمم والأقساط للطالب مباشرة مع الخصومات الدائمة.">
            {plans.length > 0 ? (
              <div className="space-y-3">
                <Checkbox checked={applyFees} onChange={(e) => setApplyFees(e.target.checked)} label="إضافة الرسوم المقررة لهذا الصف تلقائيًا" />
                <ul className="space-y-1.5 text-sm">
                  {plans.map((p, i) => (
                    <li key={i} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span>
                        {p.chargeTypeName}
                        {p.installmentsCount > 1 ? <span className="text-xs text-slate-500"> — {p.installmentsCount} أقساط</span> : null}
                      </span>
                      {f.money(p.amount)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {v.gradeId ? 'لا توجد رسوم مقررة لهذا الصف في السنة المختارة. يمكنك إضافة الذمم يدويًا من ملف الطالب.' : 'اختر الصف لعرض رسومه المقررة.'}
              </p>
            )}
          </FormSection>
        ) : null}

        {duplicate ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>{duplicate}</p>
            </div>
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => submit(true)} loading={pending}>
              حفظ رغم التشابه
            </Button>
          </div>
        ) : null}

        <div className="card sticky bottom-4 flex flex-col gap-2 p-4">
          <Button type="submit" size="lg" loading={pending}>
            {!pending ? mode === 'create' ? <UserPlus /> : <Save /> : null}
            {mode === 'create' ? 'حفظ الطالب' : 'حفظ التعديلات'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            إلغاء
          </Button>
          <p className="text-center text-xs text-slate-400">العملة: {format.currencyCode}</p>
        </div>
      </div>
    </form>
  )
}
