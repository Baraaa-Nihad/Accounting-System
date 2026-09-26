import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createBackup, pruneAutoBackups } from '@/server/backup/engine'
import { getSettings } from '@/server/settings'

/**
 * تشغيل نسخة تلقائية من مهمة cron خارجية (اختياري): يتطلب BACKUP_CRON_TOKEN في البيئة
 * وترويسة x-backup-token مطابقة. المجدول الداخلي يكفي عادةً.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.BACKUP_CRON_TOKEN ?? ''
  const got = request.headers.get('x-backup-token') ?? ''
  if (expected.length < 16 || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const meta = await createBackup('auto', null, 'تشغيل خارجي (cron)')
    const removed = await pruneAutoBackups((await getSettings()).backup.retention)
    return NextResponse.json({ ok: true, fileName: meta.fileName, removed })
  } catch (e) {
    console.error('[backup cron]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
