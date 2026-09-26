/** يُستدعى مرة واحدة عند بدء الخادم: تشغيل مجدول النسخ الاحتياطي التلقائي (بيئة Node فقط). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DISABLE_BACKUP_SCHEDULER !== 'true') {
    const { startBackupScheduler } = await import('./server/backup/scheduler')
    startBackupScheduler()
  }
}
