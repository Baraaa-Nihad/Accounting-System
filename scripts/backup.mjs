/**
 * تشغيل نسخة احتياطية تلقائية من cron خارجي (اختياري؛ المجدول الداخلي يكفي عادةً):
 *   BACKUP_CRON_TOKEN=... APP_URL=http://localhost:3000 npm run backup
 */
import 'dotenv/config'

const url = `${process.env.APP_URL || 'http://localhost:3000'}/api/backups/run`
const token = process.env.BACKUP_CRON_TOKEN
if (!token || token.length < 16) {
  console.error('اضبط BACKUP_CRON_TOKEN (16 حرفًا على الأقل) في ملف البيئة')
  process.exit(1)
}
const res = await fetch(url, { method: 'POST', headers: { 'x-backup-token': token } })
const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error('فشل النسخ الاحتياطي:', body.error ?? res.status)
  process.exit(1)
}
console.log('تمت النسخة:', body.fileName, body.removed?.length ? `(حُذفت ${body.removed.length} نسخة قديمة)` : '')
