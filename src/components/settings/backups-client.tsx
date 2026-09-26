'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { DatabaseBackup, Download, History, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/input'
import { Field, FormSection } from '@/components/ui/field'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAction } from '@/lib/use-action'
import { RESTORE_PHRASE } from '@/lib/backup-constants'
import { saveSettingsAction } from '@/app/(app)/settings/actions'
import { createBackupAction, deleteBackupAction, restoreBackupAction, verifyBackupAction } from '@/app/(app)/settings/backups/actions'

export function CreateBackupButton({ disabled }: { disabled?: boolean }) {
  const { run, pending } = useAction(createBackupAction)
  return (
    <Button size="lg" loading={pending} disabled={disabled} onClick={() => run(undefined as never)}>
      {!pending ? <DatabaseBackup /> : null}
      {pending ? 'جارٍ إنشاء النسخة...' : 'نسخ احتياطي الآن'}
    </Button>
  )
}

export function BackupSettingsForm({ value }: { value: { autoEnabled: boolean; hour: number; minute: number; retention: number } }) {
  const [v, setV] = React.useState(value)
  const { run, pending } = useAction((x: unknown) => saveSettingsAction('backup', x))
  const num = (k: 'hour' | 'minute' | 'retention') => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: Number(e.target.value) || 0 }))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(v)
      }}
    >
      <FormSection title="النسخ التلقائي" description="نسخة مشفرة يوميًا في الوقت المحدد (بتوقيت المدرسة)، مع حذف النسخ التلقائية الأقدم تلقائيًا.">
        <div className="grid items-end gap-4 sm:grid-cols-4">
          <Checkbox className="sm:col-span-4" checked={v.autoEnabled} onChange={(e) => setV((p) => ({ ...p, autoEnabled: e.target.checked }))} label="تفعيل النسخ التلقائي اليومي" />
          <Field label="الساعة (0–23)">
            <Input type="number" min={0} max={23} value={v.hour} onChange={num('hour')} dir="ltr" className="text-left" />
          </Field>
          <Field label="الدقيقة">
            <Input type="number" min={0} max={59} value={v.minute} onChange={num('minute')} dir="ltr" className="text-left" />
          </Field>
          <Field label="الاحتفاظ بآخر (نسخة تلقائية)">
            <Input type="number" min={1} max={365} value={v.retention} onChange={num('retention')} dir="ltr" className="text-left" />
          </Field>
          <Button type="submit" loading={pending}>
            حفظ
          </Button>
        </div>
      </FormSection>
    </form>
  )
}

/** رفع ملف نسخة (من قرص خارجي مثلًا) — يتدفق مباشرة للخادم ويُتحقق منه بالمفتاح الحالي. */
export function UploadBackupButton() {
  const router = useRouter()
  const ref = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".bak"
        className="hidden"
        aria-label="ملف نسخة احتياطية"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setPending(true)
          try {
            const res = await fetch('/api/backups/upload', { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
            if (res.ok && data.ok) {
              toast.success('تم رفع النسخة والتحقق منها')
              router.refresh()
            } else toast.error(data.error ?? 'تعذر رفع النسخة')
          } catch {
            toast.error('تعذر الاتصال بالخادم')
          } finally {
            setPending(false)
            if (ref.current) ref.current.value = ''
          }
        }}
      />
      <Button variant="secondary" loading={pending} onClick={() => ref.current?.click()}>
        {!pending ? <Upload /> : null}
        رفع نسخة
      </Button>
    </>
  )
}

export function BackupRowActions({ fileName, label }: { fileName: string; label: string }) {
  const router = useRouter()
  const verify = useAction(verifyBackupAction, { refresh: false })
  const [del, setDel] = React.useState(false)
  const remove = useAction(deleteBackupAction, { onSuccess: () => setDel(false) })
  const [restoreOpen, setRestoreOpen] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [phrase, setPhrase] = React.useState('')
  const restore = useAction(restoreBackupAction, {
    refresh: false,
    onSuccess: () => {
      setRestoreOpen(false)
      router.replace('/login')
    },
  })
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button variant="ghost" size="sm" asChild>
        <a href={`/api/backups/${fileName}`} aria-label={`تنزيل ${label}`}>
          <Download />
          تنزيل
        </a>
      </Button>
      <Button variant="ghost" size="sm" loading={verify.pending} onClick={() => verify.run(fileName)}>
        {!verify.pending ? <ShieldCheck /> : null}
        تحقق
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)}>
        <History />
        استعادة
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setDel(true)} aria-label={`حذف ${label}`}>
        <Trash2 />
      </Button>
      <ConfirmDialog open={del} onOpenChange={setDel} title="حذف هذه النسخة؟" description={label} confirmLabel="حذف" danger pending={remove.pending} onConfirm={() => remove.run(fileName)} />
      <Dialog
        open={restoreOpen}
        onOpenChange={(o) => {
          setRestoreOpen(o)
          if (!o) {
            setPassword('')
            setPhrase('')
          }
        }}
      >
        <DialogContent
          title="استعادة نسخة احتياطية"
          description={`ستُستبدل كل البيانات الحالية بمحتوى النسخة (${label}). تُؤخذ نسخة أمان من الوضع الحالي أولًا، وتنتهي كل الجلسات بعد الاستعادة.`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRestoreOpen(false)}>
                تراجع
              </Button>
              <Button variant="danger" loading={restore.pending} disabled={phrase.trim() !== RESTORE_PHRASE || !password} onClick={() => restore.run({ fileName, password, phrase })}>
                استعادة الآن
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="كلمة مرورك" required error={restore.fieldErrors.password}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" />
            </Field>
            <Field label={`للتأكيد اكتب: ${RESTORE_PHRASE}`} required error={restore.fieldErrors.phrase}>
              <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </Field>
            {restore.pending ? <p className="text-sm text-amber-700">جارٍ الاستعادة... لا تغلق الصفحة.</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
