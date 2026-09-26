import 'server-only'
import { db, type DbOrTx, type Tx } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { fromDateOnly, toDateOnly, type DateOnly } from '@/lib/dates'

// ---------------------------------------------------------------------
// المراحل والصفوف والشعب
// ---------------------------------------------------------------------

export async function listGradesWithSections(client: DbOrTx = db, options?: { activeOnly?: boolean }) {
  return client.grade.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { sections: { orderBy: { name: 'asc' } }, stage: true, nextGrade: { select: { id: true, name: true } } },
  })
}

export async function listStages(client: DbOrTx = db) {
  return client.stage.findMany({ orderBy: { sortOrder: 'asc' } })
}

export async function saveStage(tx: Tx, ctx: Ctx, input: { id?: number | null; name: string; sortOrder?: number }) {
  const name = input.name.trim()
  if (!name) throw new BusinessError('اسم المرحلة مطلوب')
  const clash = await tx.stage.findFirst({ where: { name, ...(input.id ? { id: { not: input.id } } : {}) } })
  if (clash) throw new BusinessError('يوجد مرحلة بنفس الاسم')
  const stage = input.id
    ? await tx.stage.update({ where: { id: input.id }, data: { name, sortOrder: input.sortOrder ?? 0 } })
    : await tx.stage.create({ data: { name, sortOrder: input.sortOrder ?? (await tx.stage.count()) + 1 } })
  await audit(tx, ctx, { action: input.id ? 'update' : 'create', entityType: 'Stage', entityId: stage.id, entityLabel: stage.name, after: stage })
  return stage
}

export async function saveGrade(
  tx: Tx,
  ctx: Ctx,
  input: { id?: number | null; name: string; stageId?: number | null; sortOrder?: number; nextGradeId?: number | null; isActive?: boolean },
) {
  const name = input.name.trim()
  if (!name) throw new BusinessError('اسم الصف مطلوب')
  const clash = await tx.grade.findFirst({ where: { name, ...(input.id ? { id: { not: input.id } } : {}) } })
  if (clash) throw new BusinessError('يوجد صف بنفس الاسم')
  if (input.id && input.nextGradeId === input.id) throw new BusinessError('لا يمكن أن يكون الصف التالي هو نفس الصف')
  const before = input.id ? await tx.grade.findUnique({ where: { id: input.id } }) : null
  const data = {
    name,
    stageId: input.stageId ?? null,
    sortOrder: input.sortOrder ?? (await tx.grade.count()) + 1,
    nextGradeId: input.nextGradeId ?? null,
    isActive: input.isActive ?? true,
  }
  const grade = input.id ? await tx.grade.update({ where: { id: input.id }, data }) : await tx.grade.create({ data })
  if (!input.id) await tx.section.create({ data: { gradeId: grade.id, name: 'أ' } })
  await audit(tx, ctx, { action: input.id ? 'update' : 'create', entityType: 'Grade', entityId: grade.id, entityLabel: grade.name, before, after: grade })
  return grade
}

export async function addSection(tx: Tx, ctx: Ctx, gradeId: number, name: string) {
  const n = name.trim()
  if (!n) throw new BusinessError('اسم الشعبة مطلوب')
  const grade = await tx.grade.findUnique({ where: { id: gradeId } })
  if (!grade) throw new BusinessError('الصف غير موجود')
  const exists = await tx.section.findUnique({ where: { gradeId_name: { gradeId, name: n } } })
  if (exists) return exists
  const section = await tx.section.create({ data: { gradeId, name: n } })
  await audit(tx, ctx, { action: 'create', entityType: 'Section', entityId: section.id, entityLabel: `${grade.name} - ${n}`, after: section })
  return section
}

export async function removeSection(tx: Tx, ctx: Ctx, sectionId: number) {
  const section = await tx.section.findUnique({ where: { id: sectionId }, include: { _count: { select: { enrollments: true } } } })
  if (!section) throw new BusinessError('الشعبة غير موجودة')
  if (section._count.enrollments > 0) throw new BusinessError('لا يمكن حذف شعبة فيها طلاب مسجلون')
  await tx.section.delete({ where: { id: sectionId } })
  await audit(tx, ctx, { action: 'delete', entityType: 'Section', entityId: sectionId, entityLabel: section.name, before: section })
}

// ---------------------------------------------------------------------
// السنوات الدراسية
// ---------------------------------------------------------------------

export async function createAcademicYear(
  tx: Tx,
  ctx: Ctx,
  input: { name: string; startDate: DateOnly; endDate: DateOnly; makeCurrent?: boolean },
) {
  const name = input.name.trim()
  if (!/^\d{4}\s*\/\s*\d{4}$/.test(name)) throw new BusinessError('اكتب اسم السنة بالشكل 2026/2027', { name: 'مثال: 2026/2027' })
  if (input.endDate <= input.startDate) throw new BusinessError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية', { endDate: 'بعد تاريخ البداية' })
  const overlap = await tx.academicYear.findFirst({
    where: { startDate: { lte: fromDateOnly(input.endDate) }, endDate: { gte: fromDateOnly(input.startDate) } },
  })
  if (overlap) throw new BusinessError(`الفترة تتداخل مع السنة ${overlap.name}`)
  const exists = await tx.academicYear.findUnique({ where: { name: name.replace(/\s/g, '') } })
  if (exists) throw new BusinessError('يوجد سنة بنفس الاسم')
  if (input.makeCurrent) await tx.academicYear.updateMany({ data: { isCurrent: false } })
  const year = await tx.academicYear.create({
    data: {
      name: name.replace(/\s/g, ''),
      startDate: fromDateOnly(input.startDate),
      endDate: fromDateOnly(input.endDate),
      isCurrent: !!input.makeCurrent,
    },
  })
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'AcademicYear',
    entityId: year.id,
    entityLabel: year.name,
    summary: `إنشاء السنة الدراسية ${year.name} (${input.startDate} ← ${input.endDate})`,
    after: year,
  })
  return year
}

export async function setCurrentYear(tx: Tx, ctx: Ctx, yearId: number) {
  const year = await tx.academicYear.findUnique({ where: { id: yearId } })
  if (!year) throw new BusinessError('السنة غير موجودة')
  const prev = await tx.academicYear.findFirst({ where: { isCurrent: true } })
  await tx.academicYear.updateMany({ data: { isCurrent: false } })
  await tx.academicYear.update({ where: { id: yearId }, data: { isCurrent: true } })
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'AcademicYear',
    entityId: yearId,
    entityLabel: year.name,
    summary: `تعيين ${year.name} سنة حالية${prev ? ` بدلًا من ${prev.name}` : ''}`,
  })
}

export async function updateAcademicYearDates(tx: Tx, ctx: Ctx, yearId: number, input: { startDate: DateOnly; endDate: DateOnly }) {
  const year = await tx.academicYear.findUnique({ where: { id: yearId } })
  if (!year) throw new BusinessError('السنة غير موجودة')
  if (year.status === 'CLOSED') throw new BusinessError('لا يمكن تعديل تواريخ سنة مغلقة')
  if (input.endDate <= input.startDate) throw new BusinessError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية')
  const overlap = await tx.academicYear.findFirst({
    where: {
      id: { not: yearId },
      startDate: { lte: fromDateOnly(input.endDate) },
      endDate: { gte: fromDateOnly(input.startDate) },
    },
  })
  if (overlap) throw new BusinessError(`الفترة تتداخل مع السنة ${overlap.name}`)
  // لا يجوز أن تخرج حركات مرحّلة عن نطاق السنة
  const outside = await tx.journalEntry.count({
    where: {
      academicYearId: yearId,
      OR: [{ date: { lt: fromDateOnly(input.startDate) } }, { date: { gt: fromDateOnly(input.endDate) } }],
    },
  })
  if (outside > 0) throw new BusinessError('يوجد قيود مرحّلة خارج الفترة الجديدة، لا يمكن تقليص السنة')
  const after = await tx.academicYear.update({
    where: { id: yearId },
    data: { startDate: fromDateOnly(input.startDate), endDate: fromDateOnly(input.endDate) },
  })
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'AcademicYear',
    entityId: yearId,
    entityLabel: year.name,
    before: { startDate: toDateOnly(year.startDate), endDate: toDateOnly(year.endDate) },
    after: { startDate: toDateOnly(after.startDate), endDate: toDateOnly(after.endDate) },
  })
  return after
}
