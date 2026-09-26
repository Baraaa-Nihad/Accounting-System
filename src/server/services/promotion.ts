import 'server-only'
import type { DbOrTx, Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { applyFeePlansToStudent } from './charges'
import { today as todayOf } from '../settings'
import { toDateOnly } from '@/lib/dates'

/**
 * ترحيل الطلاب للسنة الجديدة (docs/05-workflows.md §5.24): تسجيل جديد لكل طالب مرحّل أو معيد
 * في السنة الهدف، دون تعديل بيانات السنة القديمة (تُعلَّم نتيجة التسجيل القديم فقط)،
 * والخريجون تتغير حالتهم إلى «متخرج».
 */

export type PromotionAction = 'promote' | 'repeat' | 'graduate' | 'skip'

export async function promotionCandidates(client: DbOrTx, fromYearId: number, toYearId: number) {
  const [grades, enrollments, targetEnrollments] = await Promise.all([
    client.grade.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { sections: { orderBy: { name: 'asc' } } } }),
    client.enrollment.findMany({
      where: { academicYearId: fromYearId },
      include: { student: { select: { id: true, fullName: true, studentNumber: true, status: true } }, section: { select: { name: true } } },
      orderBy: [{ grade: { sortOrder: 'asc' } }, { student: { fullName: 'asc' } }],
    }),
    client.enrollment.findMany({ where: { academicYearId: toYearId }, select: { studentId: true, grade: { select: { name: true } } } }),
  ])
  const inTarget = new Map(targetEnrollments.map((e) => [e.studentId, e.grade.name]))
  return {
    grades: grades.map((g) => ({ id: g.id, name: g.name, nextGradeId: g.nextGradeId, isActive: g.isActive, sections: g.sections.map((s) => s.name), count: enrollments.filter((e) => e.gradeId === g.id).length })),
    students: enrollments.map((e) => ({
      id: e.student.id,
      name: e.student.fullName,
      number: e.student.studentNumber,
      status: e.student.status,
      gradeId: e.gradeId,
      section: e.section?.name ?? null,
      enrollmentStatus: e.status,
      targetGrade: inTarget.get(e.student.id) ?? null,
    })),
  }
}

export interface PromotionInput {
  fromYearId: number
  toYearId: number
  /** لكل صف: الصف الهدف أو null للتخرج */
  mapping: Record<string, number | null>
  /** استثناءات لطلاب بعينهم */
  overrides: Record<string, PromotionAction>
  keepSections: boolean
  applyFees: boolean
}

/** الإجراء الافتراضي: غير الفعالين لا يُرحّلون، والصف بلا تالٍ = تخرج. */
export function defaultAction(student: { status: string }, targetGradeId: number | null | undefined): PromotionAction {
  if (student.status !== 'ACTIVE') return 'skip'
  return targetGradeId === null ? 'graduate' : 'promote'
}

export async function promoteStudents(tx: Tx, ctx: Ctx, input: PromotionInput) {
  if (input.fromYearId === input.toYearId) throw new BusinessError('اختر سنة هدف مختلفة عن السنة المصدر')
  const [from, to] = await Promise.all([tx.academicYear.findUnique({ where: { id: input.fromYearId } }), tx.academicYear.findUnique({ where: { id: input.toYearId } })])
  if (!from || !to) throw new BusinessError('السنة غير موجودة')
  if (to.startDate <= from.startDate) throw new BusinessError('السنة الهدف يجب أن تكون بعد السنة المصدر')
  if (to.status !== 'OPEN') throw new BusinessError(`السنة ${to.name} مغلقة`)
  const candidates = await promotionCandidates(tx, from.id, to.id)
  const grades = new Map(candidates.grades.map((g) => [g.id, g]))
  const sectionsByGrade = new Map(
    (await tx.section.findMany({ select: { id: true, gradeId: true, name: true } })).map((s) => [`${s.gradeId}|${s.name}`, s.id]),
  )
  const today = await todayOf(tx)
  const feeDate = today < toDateOnly(to.startDate) ? toDateOnly(to.startDate) : today
  const res = { promoted: 0, repeated: 0, graduated: 0, skipped: 0, already: 0, fees: 0 }
  const details: string[] = []
  for (const s of candidates.students) {
    const mapped = input.mapping[String(s.gradeId)]
    const target = mapped === undefined ? grades.get(s.gradeId)?.nextGradeId ?? null : mapped
    const action = input.overrides[String(s.id)] ?? defaultAction(s, target)
    if (action === 'skip') {
      res.skipped++
      continue
    }
    if (action === 'graduate') {
      if (s.status === 'GRADUATED') {
        res.skipped++
        continue
      }
      await tx.student.update({ where: { id: s.id }, data: { status: 'GRADUATED', statusChangedAt: new Date(), statusReason: `تخرج بنهاية السنة ${from.name}` } })
      await tx.enrollment.update({ where: { studentId_academicYearId: { studentId: s.id, academicYearId: from.id } }, data: { status: 'GRADUATED' } })
      res.graduated++
      details.push(`${s.name}: تخرج`)
      continue
    }
    if (s.targetGrade) {
      res.already++
      continue
    }
    const gradeId = action === 'repeat' ? s.gradeId : target
    if (!gradeId) throw new BusinessError(`حدد الصف الهدف للطلاب في ${grades.get(s.gradeId)?.name ?? 'الصف'}`)
    if (!grades.has(gradeId)) throw new BusinessError('صف هدف غير موجود')
    const sectionId = input.keepSections && s.section ? (sectionsByGrade.get(`${gradeId}|${s.section}`) ?? null) : null
    await tx.enrollment.create({ data: { studentId: s.id, academicYearId: to.id, gradeId, sectionId } })
    await tx.enrollment.update({ where: { studentId_academicYearId: { studentId: s.id, academicYearId: from.id } }, data: { status: action === 'repeat' ? 'REPEATED' : 'PROMOTED' } })
    if (s.status !== 'ACTIVE') await tx.student.update({ where: { id: s.id }, data: { status: 'ACTIVE', statusChangedAt: new Date(), statusReason: `إعادة تسجيل في ${to.name}` } })
    if (action === 'repeat') res.repeated++
    else res.promoted++
    details.push(`${s.name}: ${grades.get(s.gradeId)?.name} ← ${grades.get(gradeId)?.name}`)
    if (input.applyFees) res.fees += (await applyFeePlansToStudent(tx, ctx, s.id, to.id, { date: feeDate })).created
  }
  await audit(tx, ctx, {
    action: 'promote',
    entityType: 'AcademicYear',
    entityId: to.id,
    entityLabel: `${from.name} ← ${to.name}`,
    summary: `ترحيل الطلاب من ${from.name} إلى ${to.name}: ${res.promoted} مرحّل، ${res.repeated} معيد، ${res.graduated} متخرج، ${res.skipped} دون ترحيل${res.already ? `، ${res.already} مسجل مسبقًا` : ''}${input.applyFees ? `، ${res.fees} ذمة من الرسوم المقررة` : ''}`,
    after: { ...res, details: details.slice(0, 200) },
  })
  return res
}
