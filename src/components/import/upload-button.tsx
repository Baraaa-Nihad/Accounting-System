'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAction } from '@/lib/use-action'
import { uploadImportAction } from '@/app/(app)/import/actions'

/** رفع ملف الاستيراد: يُقرأ على الخادم ثم ننتقل لخطوة ربط الأعمدة والمعاينة. */
export function ImportUploadButton({ type, label }: { type: string; label: string }) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { run, pending } = useAction(uploadImportAction, {
    refresh: false,
    onSuccess: (data) => router.push(`/import/${data.id}`),
  })
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        aria-label={`ملف ${label}`}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const fd = new FormData()
          fd.set('type', type)
          fd.set('file', file)
          run(fd).finally(() => {
            if (inputRef.current) inputRef.current.value = ''
          })
        }}
      />
      <Button size="sm" loading={pending} onClick={() => inputRef.current?.click()}>
        {!pending ? <Upload /> : null}
        رفع ملف
      </Button>
    </>
  )
}
