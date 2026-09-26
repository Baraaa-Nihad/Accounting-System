import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSettings, today as todayOf } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { getReport, canOpenReport } from '@/server/reports/registry'
import { describeFilters, parseReportFilters } from '@/server/reports/filters'
import { buildCsv, buildWorkbook, fileResponseHeaders, type ExportTable } from '@/server/export/excel'
import { audit } from '@/server/audit'
import { requestMeta } from '@/server/auth/session'
import type { ReportColumn } from '@/server/reports/types'

/** تصدير أي تقرير إلى Excel (مع أوراق التفصيلات) أو CSV، بنفس الفلاتر المعروضة. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/reports/[id]/export'>) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const def = getReport(id)
  if (!def) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!canOpenReport(user, def) || !user.permissions.has('reports.export')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const [settings, today, selected] = await Promise.all([getSettings(), todayOf(), getSelectedYear()])
  const filters = await parseReportFilters(def, sp, { today, weekStartDay: settings.finance.weekStartDay, selected })
  const result = await def.run(filters, { today, settings, user })
  const meta = [...(await describeFilters(def, filters)), `استخرجه: ${user.fullName}`]
  const cols = (c: ReportColumn[]) => c.filter((x) => !x.viewOnly).map((x) => ({ key: x.key, header: x.header, type: x.type, width: x.width }))
  const main: ExportTable = {
    title: def.title,
    schoolName: settings.school.name,
    meta,
    columns: cols(result.columns),
    rows: result.rows,
    totals: result.totals,
    decimals: settings.finance.decimals,
    sheetName: def.title.replace(/^تقرير /, ''),
  }
  const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx'
  const tables: ExportTable[] = [main]
  if (result.summary?.length) {
    tables.push({
      title: `${def.title} — الملخص`,
      schoolName: settings.school.name,
      meta,
      columns: [
        { key: 'label', header: 'البند', width: 30 },
        { key: 'value', header: 'القيمة', width: 20 },
      ],
      rows: result.summary.map((s) => ({ label: s.label, value: s.value })),
      decimals: settings.finance.decimals,
      sheetName: 'الملخص',
    })
  }
  for (const b of result.breakdowns ?? []) {
    tables.push({ title: `${def.title} — ${b.title}`, schoolName: settings.school.name, meta, columns: cols(b.columns), rows: b.rows, totals: b.totals, decimals: settings.finance.decimals, sheetName: b.title })
  }
  const body = format === 'csv' ? buildCsv(main) : await buildWorkbook(tables)
  const m = await requestMeta()
  await audit(db, { userId: user.id, userName: user.fullName, ip: m.ip, userAgent: m.userAgent, permissions: user.permissions }, {
    action: 'export',
    entityType: 'Report',
    entityId: def.id,
    entityLabel: def.title,
    summary: `تصدير ${def.title} (${format}) — ${meta.slice(0, -1).join('، ') || 'بدون فلاتر'}`,
  })
  return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`${def.title}-${today}`, format) })
}
