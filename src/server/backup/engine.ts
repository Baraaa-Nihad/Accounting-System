import 'server-only'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { db } from '../db'
import type { Ctx } from '../context'
import { audit } from '../audit'
import { BusinessError } from '../errors'
import { backupsDir, ensureDir, storageRoot, tmpDir } from '../storage'
import { invalidateSettingsCache } from '../settings'
import { clearAccountCache } from '../ledger/accounts'
import { isSafeBackupName, listBackups, type BackupKind, type BackupMeta } from './catalog'

/**
 * النسخ الاحتياطي (docs/10-backup.md): ملف واحد مشفّر AES-256-GCM يحتوي تفريغ القاعدة
 * (pg_dump -Fc) ومجلدات المرفقات والشعار وملف وصف. المفتاح مشتق من BACKUP_ENCRYPTION_KEY
 * عبر scrypt ولا يُخزن في القاعدة. بجانب كل نسخة ملف .json بالبيانات الوصفية فقط.
 *
 * صيغة الملف: "SABK1" | salt(16) | iv(12) | فحص المفتاح(16) | البيانات المشفرة | وسم التحقق(16)
 * البيانات بعد فك التشفير: سلسلة مدخلات، لكل مدخل سطر JSON {name,size} ثم size بايت، وتنتهي بـ {"end":true}.
 */

const MAGIC = Buffer.from('SABK1')
const HEADER = MAGIC.length + 16 + 12 + 16
const TAG = 16

/** قيمة تتحقق من صحة المفتاح قبل فك التشفير (رسالة واضحة بدل بيانات عشوائية). */
function keyCheck(key: Buffer): Buffer {
  return createHmac('sha256', key).update('SABK-key-check').digest().subarray(0, 16)
}
const FILE_DIRS = ['uploads', 'branding'] as const
let busy: string | null = null

function secret(): string {
  const key = process.env.BACKUP_ENCRYPTION_KEY ?? ''
  if (key.length < 16 || key.startsWith('change-this')) {
    throw new BusinessError('مفتاح تشفير النسخ الاحتياطية غير مضبوط. اضبط BACKUP_ENCRYPTION_KEY (16 حرفًا على الأقل) في ملف البيئة واحفظ نسخة منه خارج الخادم.')
  }
  return key
}

export function encryptionConfigured(): boolean {
  try {
    secret()
    return true
  } catch {
    return false
  }
}

function deriveKey(salt: Buffer, key = secret()): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(key, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, k) => (err ? reject(err) : resolve(k))))
}

/** رابط الاتصال لأدوات PostgreSQL (بدون معاملات Prisma غير المفهومة لـ libpq). */
function pgUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set')
  const u = new URL(raw)
  u.searchParams.delete('schema')
  u.searchParams.delete('connection_limit')
  u.searchParams.delete('pool_timeout')
  return u.toString()
}

function pgBin(name: 'pg_dump' | 'pg_restore'): string {
  return process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, name) : name
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PGCONNECT_TIMEOUT: '15' } })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-4000)))
    child.on('error', (e) => reject(new BusinessError(`تعذر تشغيل ${path.basename(cmd)}: ${e.message}. تأكد من تثبيت أدوات PostgreSQL على الخادم.`)))
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${stderr.replace(/postgres(ql)?:\/\/[^\s]+/g, '[db]')}`))))
  })
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

/** كل ملفات مجلد (بمساراتها النسبية). */
async function walk(dir: string, base = dir): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

/** آخر migration في مجلد التطبيق (إصدار مخطط القاعدة المتوقع). */
async function appSchemaVersion(): Promise<string | null> {
  try {
    const dirs = (await readdir(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    return dirs.at(-1) ?? null
  } catch {
    return null
  }
}

async function dbSchemaVersion(): Promise<string | null> {
  try {
    const rows = await db.$queryRaw<{ name: string }[]>`SELECT "migration_name" AS name FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY "migration_name" DESC LIMIT 1`
    return rows[0]?.name ?? null
  } catch {
    return null
  }
}

async function appVersion(): Promise<string> {
  try {
    return (JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? '1.0.0'
  } catch {
    return '1.0.0'
  }
}

async function recordCounts() {
  const [students, receipts, vouchers, journal, audits, attachments, users] = await Promise.all([
    db.student.count(),
    db.receipt.count(),
    db.paymentVoucher.count(),
    db.journalEntry.count(),
    db.auditLog.count(),
    db.attachment.count(),
    db.user.count(),
  ])
  return { students, receipts, vouchers, journal, audits, attachments, users }
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/\.\d+Z$/, '').replace(/:/g, '-')
}

async function* archiveEntries(files: { name: string; path: string }[]) {
  for (const f of files) {
    const s = await stat(f.path)
    yield Buffer.from(`${JSON.stringify({ name: f.name, size: s.size })}\n`, 'utf8')
    for await (const chunk of createReadStream(f.path)) yield chunk as Buffer
  }
  yield Buffer.from(`${JSON.stringify({ end: true })}\n`, 'utf8')
}

/** إنشاء نسخة احتياطية مشفرة. */
export async function createBackup(kind: BackupKind, ctx: Ctx | null, note?: string | null): Promise<BackupMeta> {
  if (busy && kind !== 'pre_restore') throw new BusinessError(`يوجد ${busy} قيد التنفيذ، حاول بعد قليل`)
  const release = !busy
  if (release) busy = 'نسخ احتياطي'
  const work = await ensureDir(path.join(tmpDir(), `backup-${stamp()}-${randomBytes(4).toString('hex')}`))
  try {
    const key = secret()
    await ensureDir(backupsDir())
    const dump = path.join(work, 'database.dump')
    await run(pgBin('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--file', dump, '--dbname', pgUrl()])
    const [counts, version, schema, dumpSha] = await Promise.all([recordCounts(), appVersion(), dbSchemaVersion(), sha256File(dump)])
    const createdAt = new Date()
    const fileName = `backup-${stamp(createdAt)}-${kind === 'pre_restore' ? 'pre-restore' : kind}.bak`
    const manifest = { format: 1, kind, createdAt: createdAt.toISOString(), appVersion: version, schemaVersion: schema, database: { file: 'database.dump', sha256: dumpSha }, counts, createdBy: ctx?.userName ?? 'النظام', note: note ?? null }
    await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const files = [
      { name: 'manifest.json', path: path.join(work, 'manifest.json') },
      { name: 'database.dump', path: dump },
      ...(await Promise.all(FILE_DIRS.map(async (dir) => (await walk(path.join(/*turbopackIgnore: true*/ storageRoot(), dir))).map((rel) => ({ name: `${dir}/${rel}`, path: path.join(/*turbopackIgnore: true*/ storageRoot(), dir, rel) }))))).flat(),
    ]

    // التشفير المتدفق: رأس الملف ثم البيانات المشفرة ثم وسم التحقق
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const derived = await deriveKey(salt, key)
    const cipher = createCipheriv('aes-256-gcm', derived, iv)
    const target = path.join(backupsDir(), fileName)
    const partial = `${target}.partial`
    const hash = createHash('sha256')
    const out = createWriteStream(partial, { flags: 'wx' })
    const header = Buffer.concat([MAGIC, salt, iv, keyCheck(derived)])
    hash.update(header)
    out.write(header)
    await pipeline(
      Readable.from(archiveEntries(files)),
      cipher,
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk)
          cb(null, chunk)
        },
      }),
      out,
    )
    const tag = cipher.getAuthTag()
    hash.update(tag)
    const fh = await open(partial, 'a')
    await fh.write(tag)
    await fh.close()
    await rename(partial, target)
    const size = (await stat(target)).size
    const meta: BackupMeta = {
      fileName,
      kind,
      createdAt: createdAt.toISOString(),
      sizeBytes: size,
      sha256: hash.digest('hex'),
      encrypted: true,
      appVersion: version,
      createdBy: ctx?.userName ?? 'النظام',
      counts,
      note: note ?? null,
    }
    await writeFile(`${target}.json`, JSON.stringify(meta, null, 2))
    await audit(db, ctx ?? { userId: null, userName: 'النظام', ip: null, userAgent: null, permissions: new Set() }, {
      action: 'backup',
      entityType: 'Backup',
      entityId: fileName,
      entityLabel: fileName,
      summary: `نسخة احتياطية ${kind === 'auto' ? 'تلقائية' : kind === 'manual' ? 'يدوية' : 'قبل الاستعادة'} (${(size / 1024 / 1024).toFixed(2)} MB — ${counts.students} طالب، ${counts.receipts} سند قبض، ${counts.journal} قيد)`,
    })
    return meta
  } finally {
    await rm(work, { recursive: true, force: true })
    if (release) busy = null
  }
}

/** فك تشفير نسخة إلى مجلد مؤقت مع التحقق من سلامتها (الوسم + بصمة تفريغ القاعدة). */
export async function extractBackup(file: string, dest: string, key?: string) {
  const size = (await stat(file)).size
  if (size < HEADER + TAG) throw new BusinessError('ملف النسخة تالف أو ليس نسخة احتياطية من هذا النظام')
  const fh = await open(file, 'r')
  const header = Buffer.alloc(HEADER)
  const tag = Buffer.alloc(TAG)
  await fh.read(header, 0, HEADER, 0)
  await fh.read(tag, 0, TAG, size - TAG)
  await fh.close()
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new BusinessError('الملف ليس نسخة احتياطية من هذا النظام')
  const salt = header.subarray(MAGIC.length, MAGIC.length + 16)
  const iv = header.subarray(MAGIC.length + 16, MAGIC.length + 28)
  const derived = await deriveKey(salt, key)
  if (!timingSafeEqual(header.subarray(MAGIC.length + 28, HEADER), keyCheck(derived))) {
    throw new BusinessError('تعذر فك تشفير النسخة: مفتاح التشفير الحالي لا يطابق مفتاح هذه النسخة')
  }
  const decipher = createDecipheriv('aes-256-gcm', derived, iv)
  decipher.setAuthTag(tag)
  await mkdir(dest, { recursive: true })

  // قارئ المدخلات: سطر الرأس ثم محتوى بالحجم المحدد
  let buf: Buffer = Buffer.alloc(0)
  let current: { name: string; remaining: number; stream: import('node:fs').WriteStream } | null = null
  let ended = false
  const names: string[] = []
  const safePath = (name: string) => {
    const ok = name === 'manifest.json' || name === 'database.dump' || FILE_DIRS.some((d) => name.startsWith(`${d}/`))
    const norm = path.posix.normalize(name)
    if (!ok || norm !== name || name.includes('..') || path.posix.isAbsolute(name)) throw new BusinessError('محتوى النسخة غير صالح')
    return path.join(dest, ...name.split('/'))
  }
  const writeChunk = (s: import('node:fs').WriteStream, chunk: Buffer) => new Promise<void>((resolve, reject) => (s.write(chunk, (e) => (e ? reject(e) : resolve()))))
  const closeStream = (s: import('node:fs').WriteStream) => new Promise<void>((resolve, reject) => s.end((e?: Error | null) => (e ? reject(e) : resolve())))
  const sink = new Writable({
    async write(chunk: Buffer, _enc, cb) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
        while (buf.length && !ended) {
          if (current) {
            const take = Math.min(current.remaining, buf.length)
            if (take > 0) await writeChunk(current.stream, buf.subarray(0, take))
            current.remaining -= take
            buf = buf.subarray(take)
            if (current.remaining === 0) {
              await closeStream(current.stream)
              current = null
            } else break
          } else {
            const nl = buf.indexOf(10)
            if (nl < 0) {
              if (buf.length > 4096) throw new BusinessError('محتوى النسخة غير صالح')
              break
            }
            const h = JSON.parse(buf.subarray(0, nl).toString('utf8')) as { name?: string; size?: number; end?: boolean }
            buf = buf.subarray(nl + 1)
            if (h.end) {
              ended = true
              break
            }
            if (!h.name || typeof h.size !== 'number' || h.size < 0) throw new BusinessError('محتوى النسخة غير صالح')
            const target = safePath(h.name)
            await mkdir(path.dirname(target), { recursive: true })
            names.push(h.name)
            current = { name: h.name, remaining: h.size, stream: createWriteStream(target) }
            if (h.size === 0) {
              await closeStream(current.stream)
              current = null
            }
          }
        }
        cb()
      } catch (e) {
        cb(e as Error)
      }
    },
  })
  try {
    await pipeline(createReadStream(file, { start: HEADER, end: size - TAG - 1 }), decipher, sink)
  } catch (e) {
    // المفتاح صحيح (فُحص أعلاه)، فأي فشل هنا = بيانات معدّلة أو تالفة (يكشفها وسم GCM أو تحليل المحتوى)
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof SyntaxError || e instanceof BusinessError || /auth|unable to authenticate|Unsupported state/i.test(msg)) {
      throw new BusinessError('تعذر فك تشفير النسخة: الملف معدّل أو تالف')
    }
    throw e
  }
  if (!ended) throw new BusinessError('النسخة غير مكتملة')
  const manifest = JSON.parse(await readFile(path.join(dest, 'manifest.json'), 'utf8')) as {
    kind: BackupKind
    createdAt: string
    appVersion: string
    schemaVersion: string | null
    database: { sha256: string }
    counts: Record<string, number>
  }
  const dumpSha = await sha256File(path.join(dest, 'database.dump'))
  if (!timingSafeEqual(Buffer.from(dumpSha), Buffer.from(manifest.database.sha256))) throw new BusinessError('بصمة قاعدة البيانات داخل النسخة لا تطابق ملف الوصف')
  return { manifest, names }
}

/** التحقق من نسخة دون استعادتها (فك تشفير كامل في مجلد مؤقت ثم حذفه). */
export async function verifyBackup(fileName: string) {
  if (!isSafeBackupName(fileName)) throw new BusinessError('اسم نسخة غير صالح')
  const dest = path.join(tmpDir(), `verify-${stamp()}-${randomBytes(4).toString('hex')}`)
  try {
    const { manifest, names } = await extractBackup(path.join(backupsDir(), fileName), dest)
    return { manifest, files: names.filter((n) => n.includes('/')).length }
  } finally {
    await rm(dest, { recursive: true, force: true })
  }
}

/**
 * الاستعادة: نسخة أمان من الوضع الحالي أولًا، ثم استعادة القاعدة في معاملة واحدة
 * (pg_restore --single-transaction --clean)، ثم المرفقات، ثم إنهاء كل الجلسات.
 */
export async function restoreBackup(fileName: string, ctx: Ctx) {
  if (!isSafeBackupName(fileName)) throw new BusinessError('اسم نسخة غير صالح')
  if (busy) throw new BusinessError(`يوجد ${busy} قيد التنفيذ، حاول بعد قليل`)
  busy = 'استعادة نسخة'
  const dest = path.join(tmpDir(), `restore-${stamp()}-${randomBytes(4).toString('hex')}`)
  try {
    const source = path.join(backupsDir(), fileName)
    const { manifest } = await extractBackup(source, dest)
    const [appSchema, currentSchema] = await Promise.all([appSchemaVersion(), dbSchemaVersion()])
    if (manifest.schemaVersion && appSchema && manifest.schemaVersion > appSchema) {
      throw new BusinessError('النسخة مأخوذة من إصدار أحدث من النظام. حدّث النظام أولًا ثم استعدها.')
    }
    const safety = await createBackup('pre_restore', ctx, `قبل استعادة ${fileName}`)
    await run(pgBin('pg_restore'), ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', '--dbname', pgUrl(), path.join(dest, 'database.dump')])
    // الملفات: المجلد الحالي يُنقل جانبًا ثم يُستبدل بمحتوى النسخة (والقديم محفوظ في نسخة الأمان)
    for (const dir of FILE_DIRS) {
      const live = path.join(/*turbopackIgnore: true*/ storageRoot(), dir)
      const restored = path.join(dest, dir)
      const aside = path.join(tmpDir(), `${dir}-before-restore-${stamp()}-${randomBytes(3).toString('hex')}`)
      await rename(live, aside).catch(() => undefined)
      await rename(restored, live).catch(async () => {
        await mkdir(live, { recursive: true })
      })
      await rm(aside, { recursive: true, force: true })
    }
    invalidateSettingsCache()
    clearAccountCache()
    // القاعدة الآن بحالة النسخة: كل الجلسات تنتهي ويُطلب الدخول من جديد
    await db.session.deleteMany({})
    const userExists = ctx.userId ? await db.user.findUnique({ where: { id: ctx.userId }, select: { id: true } }) : null
    await audit(db, { ...ctx, userId: userExists ? ctx.userId : null }, {
      action: 'restore',
      entityType: 'Backup',
      entityId: fileName,
      entityLabel: fileName,
      summary: `استعادة النسخة ${fileName} (بتاريخ ${manifest.createdAt}) بواسطة ${ctx.userName}. نسخة الأمان قبل الاستعادة: ${safety.fileName}`,
    })
    const migrated = manifest.schemaVersion && appSchema && manifest.schemaVersion < appSchema
    return { manifest, safety: safety.fileName, needsMigration: !!migrated, previousSchema: currentSchema }
  } finally {
    await rm(dest, { recursive: true, force: true })
    busy = null
  }
}

/** حذف النسخ التلقائية الأقدم مع الإبقاء على آخر N (اليدوية ونسخ الأمان لا تُحذف تلقائيًا). */
export async function pruneAutoBackups(keep: number) {
  const autos = (await listBackups()).filter((b) => b.kind === 'auto')
  const removed: string[] = []
  for (const b of autos.slice(keep)) {
    await unlink(path.join(backupsDir(), b.fileName)).catch(() => undefined)
    await unlink(path.join(backupsDir(), `${b.fileName}.json`)).catch(() => undefined)
    removed.push(b.fileName)
  }
  return removed
}

export async function deleteBackup(fileName: string, ctx: Ctx) {
  if (!isSafeBackupName(fileName)) throw new BusinessError('اسم نسخة غير صالح')
  const file = path.join(backupsDir(), fileName)
  await stat(file).catch(() => {
    throw new BusinessError('النسخة غير موجودة')
  })
  await unlink(file)
  await unlink(`${file}.json`).catch(() => undefined)
  await audit(db, ctx, { action: 'delete', entityType: 'Backup', entityId: fileName, entityLabel: fileName, summary: `حذف النسخة الاحتياطية ${fileName}` })
}

/** إضافة ملف نسخة مرفوع (من خارج الخادم) بعد التحقق من أنه يُفك بالمفتاح الحالي. */
export async function importBackupFile(tempFile: string, ctx: Ctx): Promise<BackupMeta> {
  const dest = path.join(tmpDir(), `upload-${stamp()}-${randomBytes(4).toString('hex')}`)
  try {
    const { manifest } = await extractBackup(tempFile, dest)
    await ensureDir(backupsDir())
    const fileName = `backup-${stamp(new Date(manifest.createdAt))}-uploaded-${randomBytes(3).toString('hex')}.bak`
    const target = path.join(backupsDir(), fileName)
    await rename(tempFile, target)
    const meta: BackupMeta = {
      fileName,
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      sizeBytes: (await stat(target)).size,
      sha256: await sha256File(target),
      encrypted: true,
      appVersion: manifest.appVersion,
      createdBy: ctx.userName,
      counts: manifest.counts,
      note: 'نسخة مرفوعة من خارج الخادم',
    }
    await writeFile(`${target}.json`, JSON.stringify(meta, null, 2))
    await audit(db, ctx, { action: 'backup', entityType: 'Backup', entityId: fileName, entityLabel: fileName, summary: `رفع نسخة احتياطية من خارج الخادم (تاريخها ${manifest.createdAt})` })
    return meta
  } finally {
    await rm(dest, { recursive: true, force: true })
  }
}

export function backupBusy() {
  return busy
}
