import 'server-only'
import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { backupsDir } from '../storage'

/**
 * سجل النسخ الاحتياطية يُقرأ من ملفات الوصف (.json) بجانب كل نسخة،
 * وليس من قاعدة البيانات، حتى لا يضيع عند استعادة نسخة قديمة.
 */

export type BackupKind = 'auto' | 'manual' | 'pre_restore'

export interface BackupMeta {
  fileName: string
  kind: BackupKind
  createdAt: string
  sizeBytes: number
  sha256: string
  encrypted: boolean
  appVersion: string
  createdBy: string | null
  counts: Record<string, number>
  note?: string | null
}

const SAFE_NAME = /^backup-[\w.-]+\.bak$/

export function isSafeBackupName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..') && !name.includes('/')
}

export async function listBackups(): Promise<BackupMeta[]> {
  let files: string[]
  try {
    files = await readdir(backupsDir())
  } catch {
    return []
  }
  const metas: BackupMeta[] = []
  for (const f of files) {
    if (!f.endsWith('.bak.json')) continue
    try {
      const meta = JSON.parse(await readFile(path.join(backupsDir(), f), 'utf8')) as BackupMeta
      if (!isSafeBackupName(meta.fileName)) continue
      await stat(path.join(backupsDir(), meta.fileName))
      metas.push(meta)
    } catch {
      // ملف وصف تالف أو نسخة محذوفة: يُتجاهل
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function latestSuccessfulBackupDate(): Promise<Date | null> {
  const list = await listBackups()
  return list.length ? new Date(list[0].createdAt) : null
}
