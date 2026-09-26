import { History } from 'lucide-react'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { makeFormatters } from '@/lib/format-jsx'
import { diffObjects } from '@/server/audit'
import { AUDIT_ACTION } from '@/lib/labels'
import { EmptyState } from '@/components/ui/empty-state'
import { AuditChanges } from './audit-changes'

/** سجل التعديلات لكيان معين (يظهر في صفحات السندات والطلاب). */
export async function AuditTrail({ entityType, entityId }: { entityType: string; entityId: number | string }) {
  const [logs, fmt] = await Promise.all([
    db.auditLog.findMany({ where: { entityType, entityId: String(entityId) }, orderBy: { createdAt: 'desc' }, take: 50 }),
    getFormatConfig(),
  ])
  const f = makeFormatters(fmt)
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="font-semibold text-slate-900">سجل التعديلات</h3>
        <p className="text-sm text-slate-500">كل عملية على هذا المستند: من، متى، وماذا تغير.</p>
      </div>
      {logs.length === 0 ? (
        <EmptyState icon={<History />} title="لا يوجد سجل" />
      ) : (
        <ol className="divide-y divide-slate-100">
          {logs.map((l) => {
            const changes = l.before && l.after ? diffObjects(l.before, l.after) : []
            return (
              <li key={l.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {AUDIT_ACTION[l.action] ?? l.action} — {l.userName ?? 'النظام'}
                  </span>
                  <span className="text-xs text-slate-500">{f.dateTime(l.createdAt)}</span>
                </div>
                {l.summary ? <p className="mt-0.5 text-slate-600">{l.summary}</p> : null}
                {changes.length ? <AuditChanges changes={changes.map((c) => ({ field: c.field, before: JSON.stringify(c.before ?? null), after: JSON.stringify(c.after ?? null) }))} /> : null}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
