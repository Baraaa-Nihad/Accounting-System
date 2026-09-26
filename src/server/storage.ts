import 'server-only'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

/** مجلدات التخزين: المرفقات والنسخ الاحتياطية (خارج مجلد public دائمًا). */
export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR || './storage')
}

export function uploadsDir(): string {
  return path.join(storageRoot(), 'uploads')
}

export function backupsDir(): string {
  return path.join(storageRoot(), 'backups')
}

export function tmpDir(): string {
  return path.join(storageRoot(), 'tmp')
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return dir
}
