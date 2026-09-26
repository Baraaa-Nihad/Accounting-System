import 'server-only'
import { getSettings } from '../settings'
import { todayInTimeZone } from '@/lib/dates'
import { listBackups } from './catalog'
import { createBackup, encryptionConfigured, pruneAutoBackups } from './engine'

/**
 * النسخ التلقائي داخل التطبيق: فحص كل دقيقة، ونسخة واحدة يوميًا بعد الوقت المحدد في الإعدادات
 * (بتوقيت المدرسة)، ثم حذف النسخ التلقائية الأقدم من عدد الاحتفاظ.
 */

const g = globalThis as unknown as { __backupScheduler?: NodeJS.Timeout; __backupRunning?: boolean }

function localClock(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { hour: get('hour'), minute: get('minute') }
}

export async function runAutoBackupIfDue(now = new Date()) {
  if (g.__backupRunning) return null
  const settings = await getSettings()
  const cfg = settings.backup
  if (!cfg.autoEnabled || !encryptionConfigured()) return null
  const tz = settings.finance.timezone
  const clock = localClock(tz, now)
  if (clock.hour * 60 + clock.minute < cfg.hour * 60 + cfg.minute) return null
  const today = todayInTimeZone(tz, now)
  const done = (await listBackups()).some((b) => b.kind === 'auto' && todayInTimeZone(tz, new Date(b.createdAt)) === today)
  if (done) return null
  g.__backupRunning = true
  try {
    const meta = await createBackup('auto', null)
    await pruneAutoBackups(cfg.retention)
    return meta
  } catch (e) {
    console.error('[auto backup]', e)
    return null
  } finally {
    g.__backupRunning = false
  }
}

export function startBackupScheduler() {
  if (g.__backupScheduler) return
  g.__backupScheduler = setInterval(() => {
    void runAutoBackupIfDue()
  }, 60_000)
  g.__backupScheduler.unref?.()
}
