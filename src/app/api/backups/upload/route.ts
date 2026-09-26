import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { requestMeta } from '@/server/auth/session'
import { isSameOrigin } from '@/server/auth/same-origin'
import { ensureDir, tmpDir } from '@/server/storage'
import { importBackupFile } from '@/server/backup/engine'
import { BusinessError } from '@/server/errors'

const MAX_BYTES = 2 * 1024 * 1024 * 1024

/** رفع نسخة احتياطية من خارج الخادم (تدفق مباشر للملف دون حد Server Actions). */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'انتهت الجلسة' }, { status: 401 })
  if (!user.permissions.has('backup.manage')) return NextResponse.json({ error: 'لا تملك صلاحية النسخ الاحتياطي' }, { status: 403 })
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'طلب مرفوض' }, { status: 403 })
  if (!request.body) return NextResponse.json({ error: 'الملف فارغ' }, { status: 400 })
  const temp = path.join(await ensureDir(tmpDir()), `upload-${Date.now()}-${randomBytes(4).toString('hex')}.bak`)
  let size = 0
  try {
    await pipeline(
      Readable.fromWeb(request.body as import('node:stream/web').ReadableStream),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length
          cb(size > MAX_BYTES ? new BusinessError('حجم الملف كبير جدًا') : null, chunk)
        },
      }),
      createWriteStream(temp, { flags: 'wx' }),
    )
    const m = await requestMeta()
    const meta = await importBackupFile(temp, { userId: user.id, userName: user.fullName, ip: m.ip, userAgent: m.userAgent, permissions: user.permissions })
    return NextResponse.json({ ok: true, fileName: meta.fileName })
  } catch (e) {
    await rm(temp, { force: true })
    const message = e instanceof BusinessError ? e.message : 'تعذر رفع النسخة'
    if (!(e instanceof BusinessError)) console.error('[backup upload]', e)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
