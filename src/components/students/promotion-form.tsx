'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftRight, GraduationCap, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { STUDENT_STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { promoteStudentsAction } from '@/app/(app)/students/promote/actions'

type Action = 'promote' | 'repeat' | 'graduate' | 'skip'
const ACTION_LABEL: Record<Action, string> = { promote: 'ترحيل', repeat: 'إعادة الصف', graduate: 'تخرج', skip: 'عدم الترحيل' }
const GRADUATE = 'GRADUATE'

interface GradeRow {
  id: number
  name: string
  nextGradeId: number | null
  isActive: boolean
  count: number
}

interface StudentRow {
  id: number
  name: string
  number: string
  status: string
  gradeId: number
  section: string | null
  targetGrade: string | null
}

/** معالج الترحيل: ربط الصفوف ثم استثناءات الطلاب، والتنفيذ دفعة واحدة. */
export function PromotionForm({
  years,
  fromYearId,
  toYearId,
  grades,
  students,
  canApplyFees,
}: {
  years: { id: number; name: string; status: string }[]
  fromYearId: number
  toYearId: number
  grades: GradeRow[]
  students: StudentRow[]
  canApplyFees: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const withCount = grades.filter((g) => g.count > 0)
  const [mapping, setMapping] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(withCount.map((g) => [String(g.id), g.nextGradeId ? String(g.nextGradeId) : GRADUATE])),
  )
  const [overrides, setOverrides] = React.useState<Record<string, Action>>({})
  const [keepSections, setKeepSections] = React.useState(true)
  const [applyFees, setApplyFees] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [confirm, setConfirm] = React.useState(false)
  const { run, pending } = useAction(promoteStudentsAction, { onSuccess: () => { setConfirm(false); setOverrides({}) } })

  const defaultFor = (s: StudentRow): Action => (s.status !== 'ACTIVE' ? 'skip' : mapping[String(s.gradeId)] === GRADUATE ? 'graduate' : 'promote')
  const actionFor = (s: StudentRow): Action => overrides[String(s.id)] ?? defaultFor(s)
  const gradeName = (id: number) => grades.find((g) => g.id === id)?.name ?? ''
  const pending_ = students.filter((s) => !s.targetGrade)
  const counts = { promote: 0, repeat: 0, graduate: 0, skip: 0 } as Record<Action, number>
  for (const s of pending_) counts[actionFor(s)]++
  const already = students.length - pending_.length
  const filtered = q.trim() ? students.filter((s) => s.name.includes(q.trim()) || s.number.includes(q.trim())) : students
  const go = (params: Record<string, number>) => {
    const sp = new URLSearchParams({ from: String(fromYearId), to: String(toYearId), ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
    router.push(`${pathname}?${sp.toString()}`)
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            من السنة
            <Select value={fromYearId} onChange={(e) => go({ from: Number(e.target.value) })} className="min-w-44">
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </label>
          <ArrowLeftRight className="mb-3 size-5 text-slate-400" />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
            إلى السنة
            <Select value={toYearId} onChange={(e) => go({ to: Number(e.target.value) })} className="min-w-44">
              {years.map((y) => (
                <option key={y.id} value={y.id} disabled={y.status !== 'OPEN'}>
                  {y.name}
                  {y.status !== 'OPEN' ? ' (مغلقة)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <div className="ms-auto flex flex-wrap gap-2 text-sm">
            <Badge tone="teal">ترحيل {counts.promote}</Badge>
            <Badge tone="blue">إعادة {counts.repeat}</Badge>
            <Badge tone="violet">تخرج {counts.graduate}</Badge>
            <Badge tone="gray">دون ترحيل {counts.skip}</Badge>
            {already ? <Badge tone="green">مسجل مسبقًا {already}</Badge> : null}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-1">
          <CardHeader title="ربط الصفوف" description="معبأ تلقائيًا من إعداد «الصف التالي». الصف الأخير = تخرج." />
          <ul className="divide-y divide-slate-100">
            {withCount.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {g.name} <span className="text-slate-400">({g.count})</span>
                </span>
                <Select value={mapping[String(g.id)]} onChange={(e) => setMapping((m) => ({ ...m, [String(g.id)]: e.target.value }))} className="w-44" aria-label={`الصف الهدف لـ ${g.name}`}>
                  {grades
                    .filter((x) => x.isActive)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  <option value={GRADUATE}>🎓 تخرج</option>
                </Select>
              </li>
            ))}
          </ul>
          <CardBody className="space-y-3 border-t border-slate-100">
            <Checkbox checked={keepSections} onChange={(e) => setKeepSections(e.target.checked)} label="الإبقاء على نفس الشعبة" description="إن وُجدت شعبة بنفس الاسم في الصف الجديد" />
            {canApplyFees ? (
              <Checkbox checked={applyFees} onChange={(e) => setApplyFees(e.target.checked)} label="إصدار الرسوم المقررة للسنة الجديدة" description="حسب «الرسوم المقررة» لكل صف في السنة الهدف" />
            ) : null}
            <Button size="lg" className="w-full" disabled={counts.promote + counts.repeat + counts.graduate === 0} onClick={() => setConfirm(true)}>
              <GraduationCap />
              تنفيذ الترحيل
            </Button>
          </CardBody>
        </Card>

        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="الطلاب"
            description="غيّر الإجراء لأي طالب (رسوب، انسحاب...). غير الفعالين لا يُرحّلون افتراضيًا."
            actions={
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث..." className="w-56 pr-9" />
              </div>
            }
          />
          <div className="scroll-thin max-h-[640px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-start font-semibold">الطالب</th>
                  <th className="px-4 py-2 text-start font-semibold">الصف الحالي</th>
                  <th className="px-4 py-2 text-start font-semibold">الحالة</th>
                  <th className="px-4 py-2 text-start font-semibold">الإجراء</th>
                  <th className="px-4 py-2 text-start font-semibold">إلى</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const action = actionFor(s)
                  const overridden = !!overrides[String(s.id)]
                  const target = action === 'promote' ? gradeName(Number(mapping[String(s.gradeId)])) : action === 'repeat' ? gradeName(s.gradeId) : action === 'graduate' ? 'تخرج' : '—'
                  return (
                    <tr key={s.id} className={cn('border-t border-slate-100', overridden && 'bg-amber-50/50')}>
                      <td className="px-4 py-2">
                        {s.name} <span className="num text-xs text-slate-400">{s.number}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {gradeName(s.gradeId)}
                        {s.section ? ` / ${s.section}` : ''}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={STUDENT_STATUS[s.status]?.tone ?? 'gray'}>{STUDENT_STATUS[s.status]?.label ?? s.status}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        {s.targetGrade ? (
                          <Badge tone="green">مسجل في {s.targetGrade}</Badge>
                        ) : (
                          <Select
                            value={action}
                            onChange={(e) => {
                              const v = e.target.value as Action
                              setOverrides((o) => {
                                const next = { ...o }
                                if (v === defaultFor(s)) delete next[String(s.id)]
                                else next[String(s.id)] = v
                                return next
                              })
                            }}
                            className="h-8 w-36 text-sm"
                            aria-label={`إجراء ${s.name}`}
                          >
                            {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
                              <option key={a} value={a}>
                                {ACTION_LABEL[a]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{s.targetGrade ? '—' : target}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="تنفيذ الترحيل؟"
        description={`سيُنشأ ${counts.promote + counts.repeat} تسجيل جديد في السنة الهدف، ويُسجل ${counts.graduate} طالب كمتخرج. سجلات السنة القديمة لا تُحذف.`}
        confirmLabel="تنفيذ"
        pending={pending}
        onConfirm={() =>
          run({
            fromYearId,
            toYearId,
            mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v === GRADUATE ? null : Number(v)])),
            overrides,
            keepSections,
            applyFees,
          })
        }
      />
    </div>
  )
}
