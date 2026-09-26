import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSettings } from '@/server/settings'
import { isStatementKind, statementTarget, targetStatement } from '@/server/ledger/party-statements'
import { buildCsv, buildWorkbook, fileResponseHeaders } from '@/server/export/excel'
import { audit } from '@/server/audit'
import { requestMeta } from '@/server/auth/session'
import { isDateOnly } from '@/lib/dates'

/** تصدير كشف حساب (صندوق، مورد، مقاول، موظف، حساب) إلى Excel أو CSV. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/export/statement/[kind]/[id]'>) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { kind, id } = await ctx.params
  if (!isStatementKind(kind)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const target = await statementTarget(db, kind, Number(id))
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!user.permissions.has(target.permission)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!user.permissions.has('reports.export')) return NextResponse.json({ error: 'لا تملك صلاحية التصدير' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  const from = isDateOnly(sp.get('from')) ? sp.get('from') : null
  const to = isDateOnly(sp.get('to')) ? sp.get('to') : null
  const st = await targetStatement(db, target, { from, to, hideReversed: sp.get('hide') === '1' })
  const settings = await getSettings()
  const rows = [
    ...(from ? [{ date: from, description: 'رصيد افتتاحي للفترة', ref: '', debit: null, credit: null, balance: st.opening }] : []),
    ...st.rows.map((r) => ({ date: r.date, description: r.description, ref: r.entryNumber, debit: r.debit, credit: r.credit, balance: r.balance })),
  ]
  const format = sp.get('format') === 'csv' ? 'csv' : 'xlsx'
  const table = {
    title: `${target.title}: ${target.name}`,
    schoolName: settings.school.name,
    meta: [from || to ? `الفترة: ${from ?? '...'} ← ${to ?? '...'}` : 'كل الفترات', `استخرجه: ${user.fullName}`],
    columns: [
      { key: 'date', header: 'التاريخ', type: 'date' as const },
      { key: 'description', header: 'البيان', width: 50 },
      { key: 'ref', header: 'المرجع', width: 18 },
      { key: 'debit', header: target.debitLabel, type: 'money' as const },
      { key: 'credit', header: target.creditLabel, type: 'money' as const },
      { key: 'balance', header: target.balanceLabel, type: 'money' as const },
    ],
    rows,
    totals: { description: 'الإجمالي والرصيد الختامي', debit: st.totalDebit, credit: st.totalCredit, balance: st.closing },
    decimals: settings.finance.decimals,
    sheetName: 'كشف الحساب',
  }
  const body = format === 'csv' ? buildCsv(table) : await buildWorkbook(table)
  const meta = await requestMeta()
  await audit(db, { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: user.permissions }, {
    action: 'export',
    entityType: 'Statement',
    entityId: `${kind}:${id}`,
    entityLabel: target.name,
    summary: `تصدير ${target.title}: ${target.name} (${format})`,
  })
  return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`${target.title}-${target.name}`, format) })
}
