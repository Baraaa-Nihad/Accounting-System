import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getSettings } from '@/server/settings'
import { studentStatement } from '@/server/services/student-statement'
import { buildCsv, buildWorkbook, fileResponseHeaders } from '@/server/export/excel'
import { audit } from '@/server/audit'
import { requestMeta } from '@/server/auth/session'
import { isDateOnly } from '@/lib/dates'

export async function GET(request: NextRequest, ctx: RouteContext<'/api/export/student-statement/[id]'>) {
  const user = await getCurrentUser()
  if (!user || !user.permissions.has('students.view')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!user.permissions.has('reports.export')) return NextResponse.json({ error: 'لا تملك صلاحية التصدير' }, { status: 403 })
  const { id } = await ctx.params
  const student = await db.student.findUnique({ where: { id: Number(id) } })
  if (!student) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const sp = request.nextUrl.searchParams
  const from = isDateOnly(sp.get('from')) ? sp.get('from') : null
  const to = isDateOnly(sp.get('to')) ? sp.get('to') : null
  const st = await studentStatement(student.id, { from, to, hideReversed: sp.get('hide') === '1' })
  const settings = await getSettings()
  const columns = [
    { key: 'date', header: 'التاريخ', type: 'date' as const },
    { key: 'description', header: 'البيان', width: 50 },
    { key: 'ref', header: 'المرجع', width: 18 },
    { key: 'debit', header: 'مدين', type: 'money' as const },
    { key: 'credit', header: 'دائن', type: 'money' as const },
    { key: 'balance', header: 'الرصيد', type: 'money' as const },
  ]
  const rows = [
    ...(from ? [{ date: from, description: 'رصيد افتتاحي للفترة', ref: '', debit: null, credit: null, balance: st.opening }] : []),
    ...st.rows.map((r) => ({ date: r.date, description: r.description, ref: r.entryNumber, debit: r.debit, credit: r.credit, balance: r.balance })),
  ]
  const format = sp.get('format') === 'csv' ? 'csv' : 'xlsx'
  const table = {
    title: `كشف حساب الطالب: ${student.fullName} (${student.studentNumber})`,
    schoolName: settings.school.name,
    meta: [from || to ? `الفترة: ${from ?? '...'} ← ${to ?? '...'}` : 'كل الفترات', `استخرجه: ${user.fullName}`],
    columns,
    rows,
    totals: { description: 'الإجمالي والرصيد الختامي', debit: st.totalDebit, credit: st.totalCredit, balance: st.closing },
    decimals: settings.finance.decimals,
    sheetName: 'كشف الحساب',
  }
  const body = format === 'csv' ? buildCsv(table) : await buildWorkbook(table)
  const meta = await requestMeta()
  await audit(db, { userId: user.id, userName: user.fullName, ip: meta.ip, userAgent: meta.userAgent, permissions: user.permissions }, {
    action: 'export',
    entityType: 'Student',
    entityId: student.id,
    entityLabel: student.fullName,
    summary: `تصدير كشف حساب الطالب ${student.fullName} (${format})`,
  })
  return new NextResponse(new Uint8Array(body), { headers: fileResponseHeaders(`كشف-حساب-${student.fullName}`, format) })
}
