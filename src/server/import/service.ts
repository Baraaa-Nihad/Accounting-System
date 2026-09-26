import 'server-only'
import ExcelJS from 'exceljs'
import { db, Prisma, transaction } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError, PermissionError } from '../errors'
import { getSettings, today as todayOf } from '../settings'
import { getCurrentYear } from '../years'
import type { Cell } from '@/lib/import-normalize'
import { parseImportFile } from './parse'
import { autoMap } from './mapping'
import { normalizeRows } from './normalize'
import { loadLookups } from './lookups'
import { getImportType } from './registry'
import type { ImportOptions, ImportTypeDef, ParsedFile, ValidatedRow } from './types'

/**
 * جلسات الاستيراد (docs/12-excel-import.md §12.2): الملف يُقرأ ويُحفظ في دفعة «معلّقة»،
 * ثم ربط الأعمدة والخيارات، ثم المعاينة، ولا يُستورد شيء إلا عند التأكيد.
 */

const SESSION_HOURS = 24

async function cleanup() {
  // الجلسات غير المكتملة تُحذف بعد 24 ساعة (لا تحتوي بيانات مالية)
  await db.importBatch.deleteMany({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - SESSION_HOURS * 3_600_000) } } })
}

function assertTypeAccess(ctx: Ctx, def: ImportTypeDef) {
  if (!ctx.permissions.has('import.excel') || !def.permissions.some((p) => ctx.permissions.has(p))) throw new PermissionError()
}

export async function createImportSession(ctx: Ctx, input: { type: string; fileName: string; buffer: Buffer }) {
  const def = getImportType(input.type)
  if (!def) throw new BusinessError('نوع استيراد غير معروف')
  assertTypeAccess(ctx, def)
  await cleanup()
  const file = await parseImportFile(input.fileName, input.buffer)
  const [year, cash] = await Promise.all([getCurrentYear(db), db.cashAccount.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] })])
  const options: ImportOptions = { yearId: year?.id ?? null, duplicates: 'skip', createMissing: false, cashAccountId: cash?.id ?? null }
  const batch = await db.importBatch.create({
    data: {
      type: def.key,
      fileName: input.fileName.slice(0, 200),
      headers: file.headers,
      rows: { rows: file.rows as unknown as string[][], rowNumbers: file.rowNumbers },
      mapping: autoMap(file.headers, def.fields),
      options: options as unknown as object,
      totalRows: file.rows.length,
      createdById: ctx.userId,
    },
  })
  return batch
}

export interface LoadedSession {
  id: number
  def: ImportTypeDef
  fileName: string
  status: string
  file: ParsedFile
  mapping: Record<string, number | null>
  options: ImportOptions
  result: unknown
  createdAt: Date
  completedAt: Date | null
  counts: { totalRows: number; importedRows: number; skippedRows: number; errorRows: number }
}

export async function loadSession(ctx: Ctx, id: number): Promise<LoadedSession> {
  const b = await db.importBatch.findUnique({ where: { id } })
  if (!b) throw new BusinessError('جلسة الاستيراد غير موجودة أو انتهت صلاحيتها')
  const def = getImportType(b.type)
  if (!def) throw new BusinessError('نوع استيراد غير معروف')
  assertTypeAccess(ctx, def)
  if (b.createdById !== ctx.userId && !ctx.permissions.has('users.manage')) throw new PermissionError('هذه الجلسة تخص مستخدمًا آخر')
  const stored = (b.rows ?? { rows: [], rowNumbers: [] }) as unknown as { rows: Cell[][]; rowNumbers: number[] }
  return {
    id: b.id,
    def,
    fileName: b.fileName,
    status: b.status,
    file: { headers: (b.headers ?? []) as string[], rows: stored.rows, rowNumbers: stored.rowNumbers },
    mapping: (b.mapping ?? {}) as Record<string, number | null>,
    options: (b.options ?? {}) as unknown as ImportOptions,
    result: b.result,
    createdAt: b.createdAt,
    completedAt: b.completedAt,
    counts: { totalRows: b.totalRows, importedRows: b.importedRows, skippedRows: b.skippedRows, errorRows: b.errorRows },
  }
}

export async function saveSessionSettings(ctx: Ctx, id: number, input: { mapping: Record<string, number | null>; options: ImportOptions }) {
  const s = await loadSession(ctx, id)
  if (s.status !== 'PENDING') throw new BusinessError('تم تنفيذ هذا الاستيراد مسبقًا')
  const width = s.file.headers.length
  const mapping: Record<string, number | null> = {}
  const used = new Set<number>()
  for (const f of s.def.fields) {
    const idx = input.mapping[f.key]
    if (idx === null || idx === undefined || !Number.isInteger(idx) || idx < 0 || idx >= width) {
      mapping[f.key] = null
      continue
    }
    if (used.has(idx)) throw new BusinessError(`العمود «${s.file.headers[idx]}» مربوط بأكثر من حقل`)
    used.add(idx)
    mapping[f.key] = idx
  }
  const missing = s.def.fields.filter((f) => f.required && mapping[f.key] === null)
  if (missing.length) throw new BusinessError(`اربط الحقول الإجبارية: ${missing.map((f) => f.label).join('، ')}`)
  const options: ImportOptions = {
    yearId: input.options.yearId ?? null,
    duplicates: s.def.supportsUpdate && input.options.duplicates === 'update' ? 'update' : 'skip',
    createMissing: !!(s.def.supportsCreateMissing && input.options.createMissing),
    cashAccountId: input.options.cashAccountId ?? null,
  }
  if (s.def.needsYear) {
    const y = options.yearId ? await db.academicYear.findUnique({ where: { id: options.yearId } }) : null
    if (!y) throw new BusinessError('اختر السنة الدراسية')
    if (y.status !== 'OPEN') throw new BusinessError('السنة الدراسية المختارة مغلقة')
  }
  await db.importBatch.update({ where: { id }, data: { mapping, options: options as unknown as object, result: Prisma.DbNull } })
}

/** التحقق من كل الصفوف (يُستخدم في المعاينة وعند التأكيد). */
export async function validateSession(s: LoadedSession): Promise<ValidatedRow[]> {
  const settings = await getSettings()
  const rows = normalizeRows(s.def, s.file, s.mapping, settings.finance.countryDialCode)
  const env = { settings, today: await todayOf(), lookups: await loadLookups(), options: s.options }
  return s.def.validate(rows, env)
}

export function countStatuses(rows: ValidatedRow[]) {
  return {
    valid: rows.filter((r) => r.status === 'valid').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    error: rows.filter((r) => r.status === 'error').length,
  }
}

const ALREADY_DONE = 'تم تنفيذ هذا الاستيراد مسبقًا'

/** صف لم يُستورد: رقمه وحالته ورسائله. */
export interface StoredProblem {
  n: number
  s: ValidatedRow['status']
  m: string[]
}

export interface StoredResult {
  created?: number
  updated?: number
  skipped?: number
  notes?: string[]
  counts?: { valid: number; duplicate: number; error: number }
  problems?: StoredProblem[]
  lastError?: string
}

/**
 * نتيجة كل صف: قبل التنفيذ من التحقق الحالي، وبعده من النتيجة المحفوظة وقت التنفيذ
 * (status: imported للصفوف المستوردة).
 */
export interface RowOutcome {
  rowNumber: number
  status: ValidatedRow['status'] | 'imported'
  messages: string[]
  values?: Record<string, unknown>
  existingId?: number | null
}

export async function sessionOutcome(s: LoadedSession): Promise<RowOutcome[]> {
  if (s.status !== 'COMPLETED') return validateSession(s)
  const stored = (s.result ?? {}) as StoredResult
  const problems = new Map((stored.problems ?? []).map((p) => [p.n, p]))
  const normalized = normalizeRows(s.def, s.file, s.mapping, (await getSettings()).finance.countryDialCode)
  return normalized.map((r) => {
    const p = problems.get(r.rowNumber)
    return p ? { rowNumber: r.rowNumber, status: p.s, messages: p.m, values: r.values } : { rowNumber: r.rowNumber, status: 'imported' as const, messages: [], values: r.values }
  })
}

/**
 * التنفيذ: يُعاد التحقق من كل الصفوف، ثم يُستورد الصالح كله داخل معاملة واحدة
 * (إما الكل أو لا شيء) مع تحديث حالة الجلسة في نفس المعاملة.
 */
export async function commitSession(ctx: Ctx, id: number) {
  const s = await loadSession(ctx, id)
  if (s.status !== 'PENDING') throw new BusinessError(ALREADY_DONE)
  const rows = await validateSession(s)
  const counts = countStatuses(rows)
  const toCommit = rows.filter((r) => r.status === 'valid' || (r.status === 'duplicate' && s.options.duplicates === 'update'))
  if (toCommit.length === 0) throw new BusinessError('لا توجد صفوف صالحة للاستيراد')
  const settings = await getSettings()
  const env = { settings, today: await todayOf(), lookups: await loadLookups(), options: s.options, batchId: id }
  try {
    return await transaction(
      async (tx) => {
        // قفل الجلسة: يمنع التنفيذ المزدوج (الضغط مرتين أو من نافذتين)
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM import_batches WHERE id = ${id} FOR UPDATE`
        if (!locked || locked.status !== 'PENDING') throw new BusinessError(ALREADY_DONE)
        const res = await s.def.commit(tx, ctx, toCommit, env)
        const skipped = rows.length - (res.created + res.updated) - counts.error
        // نتيجة التحقق وقت التنفيذ (لتقرير ما بعد الاستيراد؛ إعادة التحقق لاحقًا ستعتبر المستورد مكررًا)
        const committed = new Set(toCommit.map((r) => r.rowNumber))
        const problems: StoredProblem[] = rows.filter((r) => !committed.has(r.rowNumber)).map((r) => ({ n: r.rowNumber, s: r.status, m: r.messages }))
        await audit(tx, ctx, {
          action: 'import',
          entityType: 'ImportBatch',
          entityId: id,
          entityLabel: `${s.def.label} — ${s.fileName}`,
          summary: `استيراد ${s.def.label} من «${s.fileName}»: ${res.created} جديد، ${res.updated} محدث، ${skipped} متجاهل، ${counts.error} خطأ`,
          after: { ...res, rows: rows.length, counts },
        })
        await tx.importBatch.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            importedRows: res.created + res.updated,
            skippedRows: skipped,
            errorRows: counts.error,
            result: { ...res, counts, problems } as unknown as object,
            completedAt: new Date(),
          },
        })
        return res
      },
      { timeout: 15 * 60_000 },
    )
  } catch (e) {
    // لم يُحفظ شيء (المعاملة أُلغيت): تبقى الجلسة قابلة للتصحيح وإعادة المحاولة
    if (!(e instanceof BusinessError && e.message === ALREADY_DONE)) {
      const lastError = e instanceof BusinessError ? e.message : 'حدث خطأ غير متوقع أثناء الاستيراد، ولم يُحفظ أي شيء.'
      await db.importBatch.updateMany({ where: { id, status: 'PENDING' }, data: { result: { lastError } } })
    }
    throw e
  }
}

/** تقرير الأخطاء: الأعمدة الأصلية + الحالة + الرسائل، لتصحيح الملف وإعادة رفعه. */
export async function errorReport(ctx: Ctx, id: number, onlyProblems = true): Promise<Buffer> {
  const s = await loadSession(ctx, id)
  const rows = await sessionOutcome(s)
  const byRow = new Map(rows.map((r) => [r.rowNumber, r]))
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('نتيجة التحقق', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  const headers = ['رقم الصف', 'الحالة', 'الرسائل', ...s.file.headers]
  ws.addRow(headers).font = { bold: true }
  const label = { valid: 'صالح', duplicate: 'مكرر', error: 'خطأ', imported: 'تم استيراده' }
  s.file.rows.forEach((raw, i) => {
    const n = s.file.rowNumbers[i]
    const v = byRow.get(n)
    if (!v || (onlyProblems && (v.status === 'valid' || v.status === 'imported'))) return
    const row = ws.addRow([n, label[v.status], v.messages.join(' | '), ...raw.map((c) => (c === undefined ? null : (c as string | number | boolean | null)))])
    row.getCell(2).font = { color: { argb: v.status === 'error' ? 'FFE11D48' : v.status === 'duplicate' ? 'FFB45309' : 'FF047857' }, bold: true }
  })
  ws.getColumn(3).width = 60
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

export async function recentSessions(ctx: Ctx, limit = 20) {
  return db.importBatch.findMany({
    where: ctx.permissions.has('users.manage') ? {} : { createdById: ctx.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, type: true, fileName: true, status: true, totalRows: true, importedRows: true, skippedRows: true, errorRows: true, createdAt: true, completedAt: true, createdById: true },
  })
}
