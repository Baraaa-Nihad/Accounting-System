import 'server-only'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFile, readFile } from 'node:fs/promises'
import { db } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError, PermissionError } from '../errors'
import { ensureDir, uploadsDir } from '../storage'
import type { Permission } from '@/lib/permissions'

/**
 * المرفقات: صور وملفات PDF مرتبطة بالحركات المالية (فواتير، شيكات، إيصالات، عقود).
 * تُحفظ خارج المجلد العام بأسماء عشوائية، ويُتحقق من نوعها الفعلي من محتواها.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const ATTACHMENT_ENTITIES: Record<string, { view: Permission; edit: Permission[]; label: string }> = {
  Student: { view: 'students.view', edit: ['students.edit', 'students.create'], label: 'طالب' },
  Receipt: { view: 'receipts.view', edit: ['receipts.create', 'receipts.edit'], label: 'سند قبض' },
  PaymentVoucher: { view: 'vouchers.view', edit: ['vouchers.create', 'vouchers.edit'], label: 'سند صرف' },
  SupplierBill: { view: 'suppliers.view', edit: ['suppliers.manage'], label: 'فاتورة مورد' },
  ContractorJob: { view: 'contractors.view', edit: ['contractors.manage'], label: 'عمل مقاول' },
  Employee: { view: 'employees.view', edit: ['employees.manage'], label: 'موظف' },
  Charge: { view: 'charges.view', edit: ['charges.create', 'charges.edit'], label: 'ذمة' },
  JournalEntry: { view: 'accounting.view', edit: ['accounting.manage'], label: 'قيد' },
}

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
]

export function detectFileType(buffer: Buffer) {
  return SIGNATURES.find((s) => s.test(buffer)) ?? null
}

export function assertAttachmentAccess(ctx: Ctx, entityType: string, mode: 'view' | 'edit') {
  const def = ATTACHMENT_ENTITIES[entityType]
  if (!def) throw new BusinessError('نوع مرفق غير مدعوم')
  const ok = mode === 'view' ? ctx.permissions.has(def.view) : def.edit.some((p) => ctx.permissions.has(p))
  if (!ok) throw new PermissionError()
}

export async function saveAttachment(ctx: Ctx, input: { entityType: string; entityId: number; file: File; description?: string | null }) {
  assertAttachmentAccess(ctx, input.entityType, 'edit')
  if (input.file.size === 0) throw new BusinessError('الملف فارغ')
  if (input.file.size > MAX_ATTACHMENT_BYTES) throw new BusinessError('حجم الملف أكبر من 10 ميغابايت')
  const buffer = Buffer.from(await input.file.arrayBuffer())
  const type = detectFileType(buffer)
  if (!type) throw new BusinessError('نوع الملف غير مسموح. المسموح: صور (JPG، PNG، WEBP، GIF) أو PDF')
  const now = new Date()
  const rel = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'))
  const fileName = `${rel}/${randomUUID()}.${type.ext}`
  await ensureDir(path.join(uploadsDir(), rel))
  await writeFile(path.join(uploadsDir(), fileName), buffer, { flag: 'wx' })
  const originalName = input.file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || `file.${type.ext}`
  const att = await db.attachment.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      fileName,
      originalName,
      mimeType: type.mime,
      size: buffer.length,
      description: input.description ?? null,
      uploadedById: ctx.userId,
    },
  })
  await audit(db, ctx, {
    action: 'create',
    entityType: 'Attachment',
    entityId: att.id,
    entityLabel: originalName,
    summary: `إرفاق ملف «${originalName}» إلى ${ATTACHMENT_ENTITIES[input.entityType].label} رقم ${input.entityId}`,
  })
  return att
}

export async function listAttachments(entityType: string, entityId: number) {
  return db.attachment.findMany({ where: { entityType, entityId, deletedAt: null }, orderBy: { createdAt: 'desc' } })
}

export async function readAttachment(ctx: Ctx, id: number) {
  const att = await db.attachment.findUnique({ where: { id } })
  if (!att || att.deletedAt) throw new BusinessError('المرفق غير موجود')
  assertAttachmentAccess(ctx, att.entityType, 'view')
  const full = path.resolve(uploadsDir(), att.fileName)
  if (!full.startsWith(path.resolve(uploadsDir()))) throw new BusinessError('مسار غير صالح')
  return { att, data: await readFile(full) }
}

export async function deleteAttachment(ctx: Ctx, id: number) {
  const att = await db.attachment.findUnique({ where: { id } })
  if (!att || att.deletedAt) throw new BusinessError('المرفق غير موجود')
  assertAttachmentAccess(ctx, att.entityType, 'edit')
  await db.attachment.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.userId } })
  await audit(db, ctx, {
    action: 'delete',
    entityType: 'Attachment',
    entityId: id,
    entityLabel: att.originalName,
    summary: `حذف المرفق «${att.originalName}» (يبقى محفوظًا في الأرشيف)`,
  })
}
