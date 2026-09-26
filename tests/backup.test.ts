import path from 'node:path'
import os from 'node:os'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, transaction } from '@/server/db'
import { createBackup, extractBackup, pruneAutoBackups, restoreBackup, verifyBackup } from '@/server/backup/engine'
import { listBackups } from '@/server/backup/catalog'
import { runAutoBackupIfDue } from '@/server/backup/scheduler'
import { backupsDir, storageRoot, uploadsDir } from '@/server/storage'
import { getSettings, saveSetting } from '@/server/settings'
import { testCtx } from './support/helpers'
import { makeStudent } from './support/fixtures'

const ctx = testCtx('مختبر النسخ')

beforeAll(async () => {
  // مجلد النسخ في تخزين الاختبار فقط يُفرّغ في كل تشغيل (لا يمس ملفات التطوير)
  if (!storageRoot().includes('test-storage')) throw new Error('backup tests must use the test storage dir')
  await rm(backupsDir(), { recursive: true, force: true })
})
const sha = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex')

describe('encrypted backups', () => {
  it('creates an encrypted backup with a metadata sidecar and verifies it', async () => {
    const meta = await createBackup('manual', ctx, 'اختبار')
    const file = path.join(backupsDir(), meta.fileName)
    expect(meta.encrypted).toBe(true)
    expect(meta.sha256).toBe(await sha(file))
    const raw = await readFile(file)
    expect(raw.subarray(0, 5).toString()).toBe('SABK1')
    // لا نص واضح من القاعدة داخل الملف
    expect(raw.includes(Buffer.from('CREATE TABLE'))).toBe(false)
    const sidecar = JSON.parse(await readFile(`${file}.json`, 'utf8'))
    expect(sidecar.fileName).toBe(meta.fileName)
    expect(JSON.stringify(sidecar)).not.toMatch(/passwordHash|DATABASE_URL/)
    expect((await listBackups()).some((b) => b.fileName === meta.fileName)).toBe(true)
    const v = await verifyBackup(meta.fileName)
    expect(v.manifest.counts.students).toBe(meta.counts.students)
    expect(await db.auditLog.count({ where: { action: 'backup', entityId: meta.fileName } })).toBe(1)
  })

  it('rejects tampered files and wrong keys', async () => {
    const meta = await createBackup('manual', ctx)
    const file = path.join(backupsDir(), meta.fileName)
    const tmp = path.join(os.tmpdir(), `tampered-${Date.now()}.bak`)
    const buf = await readFile(file)
    buf[Math.floor(buf.length / 2)] ^= 0xff
    await writeFile(tmp, buf)
    const dest = path.join(os.tmpdir(), `x-${Date.now()}`)
    await expect(extractBackup(tmp, dest)).rejects.toThrow(/تعذر فك تشفير/)
    await expect(extractBackup(file, `${dest}-k`, 'a-completely-different-key-123')).rejects.toThrow(/تعذر فك تشفير/)
    await writeFile(tmp, Buffer.from('not a backup at all, just text'))
    await expect(extractBackup(tmp, `${dest}-m`)).rejects.toThrow(/ليس نسخة/)
    await Promise.all([rm(tmp, { force: true }), rm(dest, { recursive: true, force: true }), rm(`${dest}-k`, { recursive: true, force: true }), rm(`${dest}-m`, { recursive: true, force: true })])
  })

  it('restores the database and attachments exactly, after a safety backup', async () => {
    await mkdir(path.join(uploadsDir(), 'test'), { recursive: true })
    const attachment = path.join(uploadsDir(), 'test', `invoice-${Date.now()}.txt`)
    await writeFile(attachment, 'فاتورة اختبار')
    const before = await db.student.count()
    const meta = await createBackup('manual', ctx, 'قبل تعديلات')

    // تغييرات بعد النسخة: طالب جديد وحذف المرفق وجلسة
    const extra = await makeStudent()
    await rm(attachment)
    const admin = await db.user.findFirstOrThrow({ where: { username: 'admin' } })
    await db.session.create({ data: { id: `r${Date.now()}`.padEnd(64, '0').slice(0, 64), userId: admin.id, expiresAt: new Date(Date.now() + 3600_000) } })

    const res = await restoreBackup(meta.fileName, ctx)
    expect(await db.student.count()).toBe(before)
    expect(await db.student.findUnique({ where: { id: extra.id } })).toBeNull()
    expect(await readFile(attachment, 'utf8')).toBe('فاتورة اختبار')
    expect(await db.session.count()).toBe(0)
    const safety = (await listBackups()).find((b) => b.fileName === res.safety)!
    expect(safety.kind).toBe('pre_restore')
    expect(await db.auditLog.count({ where: { action: 'restore', entityId: meta.fileName } })).toBe(1)
    // القاعدة المستعادة سليمة وقابلة للكتابة (القيود والتريجرات تعمل)
    const again = await makeStudent()
    expect(again.id).toBeGreaterThan(0)
    await transaction(async (tx) => {
      expect(await tx.student.count()).toBe(before + 1)
    })
  })

  it('keeps only the newest automatic backups and runs the daily schedule once', async () => {
    const dir = backupsDir()
    const fakes = ['2001-01-01T00-00-00', '2001-01-02T00-00-00', '2001-01-03T00-00-00'].map((t) => `backup-${t}-auto.bak`)
    for (const [i, name] of fakes.entries()) {
      await writeFile(path.join(dir, name), 'x')
      await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ fileName: name, kind: 'auto', createdAt: `2001-01-0${i + 1}T00:00:00.000Z`, sizeBytes: 1, sha256: '', encrypted: true, appVersion: '1', createdBy: null, counts: {} }))
    }
    const settings = await getSettings()
    await saveSetting(db, 'backup', { ...settings.backup, autoEnabled: true, hour: 0, minute: 0, retention: 2 })
    try {
      const first = await runAutoBackupIfDue()
      expect(first?.kind).toBe('auto')
      // مرة واحدة يوميًا
      expect(await runAutoBackupIfDue()).toBeNull()
      const autos = (await listBackups()).filter((b) => b.kind === 'auto')
      expect(autos).toHaveLength(2)
      expect(autos[0].fileName).toBe(first!.fileName)
      expect(autos.some((b) => b.fileName === fakes[0])).toBe(false)
      await expect(stat(path.join(dir, fakes[0]))).rejects.toThrow()
      // النسخ اليدوية لا تُحذف تلقائيًا
      expect((await listBackups()).some((b) => b.kind === 'manual')).toBe(true)
      expect(await pruneAutoBackups(100)).toEqual([])
    } finally {
      await saveSetting(db, 'backup', settings.backup)
    }
    expect(storageRoot()).toContain('test-storage')
  })
})
