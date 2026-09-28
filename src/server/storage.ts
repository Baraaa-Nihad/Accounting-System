import 'server-only'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

/**
 * مجلدات التخزين: المرفقات والنسخ الاحتياطية (خارج مجلد public دائمًا).
 * turbopackIgnore: مسارات وقت التشغيل فقط؛ بدونه يتتبع البناء المشروع كله إلى مخرجات standalone.
 */
export function storageRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || './storage')
}

export function uploadsDir(): string {
  return path.join(/*turbopackIgnore: true*/ storageRoot(), 'uploads')
}

export function backupsDir(): string {
  return path.join(/*turbopackIgnore: true*/ storageRoot(), 'backups')
}

export function tmpDir(): string {
  return path.join(/*turbopackIgnore: true*/ storageRoot(), 'tmp')
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return dir
}
