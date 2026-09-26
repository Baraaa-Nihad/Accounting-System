import { AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { getSettings, getFormatConfig } from '@/server/settings'
import { backupAgeDays, listBackups } from '@/server/backup/catalog'
import { encryptionConfigured } from '@/server/backup/engine'
import { makeFormatters } from '@/lib/format-jsx'
import type { Tone } from '@/lib/labels'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsLayout } from '@/components/settings/settings-nav'
import { Badge } from '@/components/ui/badge'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { BackupRowActions, BackupSettingsForm, CreateBackupButton, UploadBackupButton } from '@/components/settings/backups-client'

export const metadata = { title: 'النسخ الاحتياطي' }

const KIND: Record<string, { label: string; tone: Tone }> = {
  auto: { label: 'تلقائية', tone: 'blue' },
  manual: { label: 'يدوية', tone: 'teal' },
  pre_restore: { label: 'قبل الاستعادة', tone: 'amber' },
}

export default async function BackupsPage() {
  await requirePermission('backup.manage')
  const [fmt, settings, backups] = await Promise.all([getFormatConfig(), getSettings(), listBackups()])
  const f = makeFormatters(fmt)
  const keyOk = encryptionConfigured()
  const last = backups[0]
  const ageDays = backupAgeDays(last)
  const totalSize = backups.reduce((a, b) => a + b.sizeBytes, 0)
  return (
    <>
      <PageHeader
        title="النسخ الاحتياطي"
        description="كل نسخة ملف واحد مشفّر (AES-256-GCM) يضم قاعدة البيانات كاملة مع سجل النشاط والمرفقات. حمّل نسخة أسبوعيًا على الأقل واحفظها خارج الخادم."
        actions={
          <>
            <UploadBackupButton />
            <CreateBackupButton disabled={!keyOk} />
          </>
        }
      />
      <SettingsLayout active="backups">
        {!keyOk ? (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <KeyRound className="mt-0.5 size-5 shrink-0" />
            <p>
              مفتاح التشفير غير مضبوط. أضف <bdi className="ltr font-mono">BACKUP_ENCRYPTION_KEY</bdi> (16 حرفًا على الأقل) إلى ملف البيئة ثم أعد تشغيل النظام، واحفظ نسخة من المفتاح خارج الخادم:
              بدونه لا يمكن فتح أي نسخة.
            </p>
          </div>
        ) : null}
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <StatCard
            label="آخر نسخة"
            value={last ? f.dateTime(last.createdAt) : 'لا توجد'}
            accent={ageDays === null || ageDays > 2 ? 'red' : 'green'}
          />
          <StatCard label="عدد النسخ المحفوظة" value={f.number(backups.length)} />
          <StatCard label="الحجم الكلي" value={<bdi className="ltr num">{(totalSize / 1024 / 1024).toFixed(1)} MB</bdi>} />
        </div>
        {ageDays !== null && ageDays > 2 ? (
          <p className="mb-5 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="size-4" />
            مرّ أكثر من يومين على آخر نسخة احتياطية.
          </p>
        ) : null}
        <div className="mb-5">
          <BackupSettingsForm value={settings.backup} />
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <ShieldCheck className="size-5 text-brand-600" />
            <h3 className="font-semibold text-slate-900">النسخ المتوفرة على الخادم</h3>
          </div>
          {backups.length === 0 ? (
            <EmptyState title="لا توجد نسخ احتياطية بعد" description="اضغط «نسخ احتياطي الآن» لإنشاء أول نسخة." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <TH>التاريخ</TH>
                    <TH>النوع</TH>
                    <TH numeric>الحجم</TH>
                    <TH>المحتوى</TH>
                    <TH>بواسطة</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {backups.map((b) => (
                    <TR key={b.fileName}>
                      <TD className="whitespace-nowrap">
                        {f.dateTime(b.createdAt)}
                        <span className="block text-xs text-slate-400">
                          <bdi className="ltr">{b.fileName}</bdi>
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={KIND[b.kind]?.tone ?? 'gray'}>{KIND[b.kind]?.label ?? b.kind}</Badge>
                        {b.note ? <span className="mt-1 block text-xs text-slate-500">{b.note}</span> : null}
                      </TD>
                      <TD numeric>
                        <bdi className="ltr num">{(b.sizeBytes / 1024 / 1024).toFixed(2)} MB</bdi>
                      </TD>
                      <TD className="text-xs text-slate-600">
                        {b.counts.students ?? 0} طالب · {b.counts.receipts ?? 0} سند قبض · {b.counts.vouchers ?? 0} سند صرف · {b.counts.journal ?? 0} قيد · {b.counts.attachments ?? 0} مرفق
                      </TD>
                      <TD className="text-slate-500">{b.createdBy ?? 'النظام'}</TD>
                      <TD>
                        <BackupRowActions fileName={b.fileName} label={`${KIND[b.kind]?.label ?? ''} — ${b.createdAt.slice(0, 16).replace('T', ' ')}`} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </SettingsLayout>
    </>
  )
}
