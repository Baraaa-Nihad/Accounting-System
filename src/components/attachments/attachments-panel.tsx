import { Paperclip } from 'lucide-react'
import { listAttachments } from '@/server/services/attachments'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { EmptyState } from '@/components/ui/empty-state'
import { AttachmentsList, AttachmentUploader } from './attachments-client'

export async function AttachmentsPanel({ entityType, entityId, canUpload }: { entityType: string; entityId: number; canUpload: boolean }) {
  const [items, fmt] = await Promise.all([listAttachments(entityType, entityId), getFormatConfig()])
  const f = makeFormatters(fmt)
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="font-semibold text-slate-900">المرفقات</h3>
          <p className="text-sm text-slate-500">صور الفواتير والإيصالات والشيكات والعقود (صور أو PDF حتى 10 ميغابايت).</p>
        </div>
        {canUpload ? <AttachmentUploader entityType={entityType} entityId={entityId} /> : null}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Paperclip />} title="لا توجد مرفقات" />
      ) : (
        <AttachmentsList
          canDelete={canUpload}
          items={items.map((a) => ({
            id: a.id,
            name: a.originalName,
            mimeType: a.mimeType,
            size: a.size,
            description: a.description,
            createdAt: f.dateTimeText(a.createdAt),
          }))}
        />
      )}
    </div>
  )
}
