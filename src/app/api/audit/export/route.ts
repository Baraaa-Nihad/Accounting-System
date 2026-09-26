import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { audit } from '@/server/audit'
import { requestMeta } from '@/server/auth/session'
import { exportAuditLogs, isSensitive } from '@/server/services/audit-view'
import { buildWorkbook, fileResponseHeaders } from '@/server/export/excel'
import { getSettings, today as todayOf } from '@/server/settings'
import { AUDIT_ACTION, ENTITY_LABEL } from '@/lib/labels'
import { formatDateTime } from '@/lib/format'
import { isDateOnly } from '@/lib/dates'

/** تصدير سجل النشاط بالفلاتر المعروضة (بحد أقصى 20,000 سطر). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!user.permissions.has('audit.view') || !user.permissions.has('reports.export')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  const num = (k: string) => (/^\d+$/.test(sp.get(k) ?? '') ? Number(sp.get(k)) : undefined)
  const date = (k: string) => (isDateOnly(sp.get(k)) ? (sp.get(k) as string) : undefined)
  const [settings, today] = await Promise.all([getSettings(), todayOf()])
  const rows = await exportAuditLogs(
    db,
    {
      q: sp.get('q') ?? undefined,
      userId: num('user'),
      action: sp.get('action') ?? undefined,
      entityType: sp.get('entity') ?? undefined,
      entityId: sp.get('entityId') ?? undefined,
      from: date('from'),
      to: date('to'),
      sensitive: sp.get('sensitive') === '1',
    },
    settings.finance.timezone,
  )
  const cfg = { dateFormat: settings.finance.dateFormat, timezone: settings.finance.timezone }
  const body = await buildWorkbook([
    {
      title: 'سجل النشاط',
      schoolName: settings.school.name,
      meta: [`عدد السطور: ${rows.length}`, `استخرجه: ${user.fullName}`],
      columns: [
        { key: 'time', header: 'الوقت', width: 20 },
        { key: 'user', header: 'المستخدم', width: 20 },
        { key: 'action', header: 'العملية', width: 16 },
        { key: 'sensitive', header: 'حساسة', width: 8 },
        { key: 'entity', header: 'الكيان', width: 16 },
        { key: 'label', header: 'المرجع', width: 28 },
        { key: 'summary', header: 'الوصف', width: 70 },
        { key: 'ip', header: 'IP', width: 16 },
      ],
      rows: rows.map((l) => ({
        time: formatDateTime(l.createdAt, cfg),
        user: l.userName ?? 'النظام',
        action: AUDIT_ACTION[l.action] ?? l.action,
        sensitive: isSensitive(l) ? 'نعم' : '',
        entity: ENTITY_LABEL[l.entityType] ?? l.entityType,
        label: l.entityLabel ?? l.entityId ?? '',
        summary: l.summary ?? '',
        ip: l.ip ?? '',
      })),
      decimals: settings.finance.decimals,
      sheetName: 'سجل النشاط',
    },
  ])
  const m = await requestMeta()
  await audit(db, { userId: user.id, userName: user.fullName, ip: m.ip, userAgent: m.userAgent, permissions: user.permissions }, {
    action: 'export',
    entityType: 'System',
    entityLabel: 'سجل النشاط',
    summary: `تصدير سجل النشاط (${rows.length} سطر)`,
  })
  return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`سجل النشاط-${today}`, 'xlsx') })
}
