import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { audit } from '@/server/audit'
import { requestMeta } from '@/server/auth/session'
import { backupsDir } from '@/server/storage'
import { isSafeBackupName } from '@/server/backup/catalog'

/** تنزيل ملف نسخة احتياطية (مشفّر) لحفظه خارج الخادم. */
export async function GET(_request: Request, ctx: RouteContext<'/api/backups/[name]'>) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!user.permissions.has('backup.manage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { name } = await ctx.params
  if (!isSafeBackupName(name)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const file = path.join(backupsDir(), name)
  const info = await stat(file).catch(() => null)
  if (!info) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const m = await requestMeta()
  await audit(db, { userId: user.id, userName: user.fullName, ip: m.ip, userAgent: m.userAgent, permissions: user.permissions }, {
    action: 'export',
    entityType: 'Backup',
    entityId: name,
    entityLabel: name,
    summary: `تنزيل النسخة الاحتياطية ${name}`,
  })
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(info.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
