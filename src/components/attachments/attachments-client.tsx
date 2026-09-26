'use client'

import * as React from 'react'
import { Upload, FileText, ImageIcon, Trash2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAction } from '@/lib/use-action'
import { deleteAttachmentAction, uploadAttachmentAction } from '@/app/(app)/attachments/actions'

export function AttachmentUploader({ entityType, entityId }: { entityType: string; entityId: number }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { run, pending } = useAction(uploadAttachmentAction)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const fd = new FormData()
          fd.set('entityType', entityType)
          fd.set('entityId', String(entityId))
          fd.set('file', file)
          run(fd).finally(() => {
            if (inputRef.current) inputRef.current.value = ''
          })
        }}
      />
      <Button variant="secondary" loading={pending} onClick={() => inputRef.current?.click()}>
        {!pending ? <Upload /> : null}
        رفع مرفق
      </Button>
    </>
  )
}

export function AttachmentsList({
  items,
  canDelete,
}: {
  items: { id: number; name: string; mimeType: string; size: number; description: string | null; createdAt: string }[]
  canDelete: boolean
}) {
  const del = useAction(deleteAttachmentAction)
  return (
    <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
          <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500">
            {a.mimeType.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/attachments/${a.id}`} alt="" className="size-12 object-cover" />
            ) : a.mimeType === 'application/pdf' ? (
              <FileText className="size-6" />
            ) : (
              <ImageIcon className="size-6" />
            )}
          </a>
          <div className="min-w-0 flex-1">
            <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-slate-800 hover:text-brand-700">
              {a.name}
            </a>
            <p className="text-xs text-slate-500">
              {(a.size / 1024).toFixed(0)} KB · {a.createdAt}
            </p>
          </div>
          <a href={`/api/attachments/${a.id}?download=1`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="تنزيل">
            <Download className="size-4" />
          </a>
          {canDelete ? (
            <button
              type="button"
              onClick={() => {
                if (confirm('حذف هذا المرفق؟')) del.run(a.id)
              }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              aria-label="حذف"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
