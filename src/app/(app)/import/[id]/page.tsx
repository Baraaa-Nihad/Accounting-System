import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CheckCircle2, Download, FileSpreadsheet } from 'lucide-react'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'
import type { Ctx } from '@/server/context'
import { BusinessError, PermissionError } from '@/server/errors'
import { loadSession, sessionOutcome, type LoadedSession, type StoredResult } from '@/server/import/service'
import { boxOptionsFor } from '@/server/services/treasury'
import { getFormatConfig } from '@/server/settings'
import { listYears } from '@/server/years'
import { makeFormatters } from '@/lib/format-jsx'
import { IMPORT_ROW_STATUS, IMPORT_STATUS } from '@/lib/labels'
import { firstParam, intParam, withParams } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { LinkTabs } from '@/components/ui/link-tabs'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { ImportSteps } from '@/components/import/import-steps'
import { ImportCellValue } from '@/components/import/cell-value'
import { ImportWorkspace } from '@/components/import/import-workspace'
import { KIND_HELP } from '@/server/import/kind-help'

export const metadata = { title: 'معاينة الاستيراد' }

const PAGE_SIZE = 50

/** أين تظهر البيانات بعد استيرادها. */
const RESULT_LINKS: Record<string, { href: string; label: string }> = {
  students: { href: '/students', label: 'قائمة الطلاب' },
  teachers: { href: '/employees', label: 'قائمة الموظفين' },
  employees: { href: '/employees', label: 'قائمة الموظفين' },
  balances: { href: '/charges', label: 'الذمم' },
  charges: { href: '/charges', label: 'الذمم' },
  installments: { href: '/charges', label: 'الذمم' },
  suppliers: { href: '/suppliers', label: 'الموردين' },
  expenses: { href: '/vouchers', label: 'سندات الصرف' },
  vouchers: { href: '/vouchers', label: 'سندات الصرف' },
  receipts: { href: '/receipts', label: 'سندات القبض' },
}

export default async function ImportSessionPage({ params, searchParams }: PageProps<'/import/[id]'>) {
  const user = await requirePermission('import.excel')
  const { id } = await params
  const sp = await searchParams
  const ctx: Ctx = { userId: user.id, userName: user.fullName, ip: null, userAgent: null, permissions: user.permissions }
  const batchId = Number(id)
  if (!Number.isInteger(batchId) || batchId <= 0) notFound()
  let s: LoadedSession
  try {
    s = await loadSession(ctx, batchId)
  } catch (e) {
    if (e instanceof PermissionError) redirect('/forbidden')
    if (e instanceof BusinessError) notFound()
    throw e
  }
  const [fmt, outcome, years, cash] = await Promise.all([
    getFormatConfig(),
    sessionOutcome(s),
    listYears(),
    boxOptionsFor(db, user.id, user.permissions).then((list) => list.map((c) => ({ id: c.id, name: c.name }))),
  ])
  const f = makeFormatters(fmt)
  const completed = s.status === 'COMPLETED'
  const stored = (s.result ?? {}) as StoredResult

  // عدّاد الحالات + الفلترة والتصفح
  const counts = { valid: 0, duplicate: 0, error: 0, imported: 0 }
  for (const r of outcome) counts[r.status]++
  const statusKeys = completed ? ['imported', 'duplicate', 'error'] : ['valid', 'duplicate', 'error']
  const statusParam = firstParam(sp.status)
  const status = statusParam && statusKeys.includes(statusParam) ? statusParam : 'all'
  const filtered = status === 'all' ? outcome : outcome.filter((r) => r.status === status)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, intParam(sp.page) ?? 1), pages)
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const rawByRow = new Map(s.file.rowNumbers.map((n, i) => [n, s.file.rows[i]]))
  const mappedFields = s.def.fields.filter((x) => s.mapping[x.key] !== null && s.mapping[x.key] !== undefined)
  const path = `/import/${s.id}`

  const toUpdate = s.options.duplicates === 'update' ? outcome.filter((r) => r.status === 'duplicate' && r.existingId).length : 0
  const tabs = [
    { key: 'all', label: 'كل الصفوف', href: withParams(path, sp, { status: null, page: null }), count: outcome.length },
    ...statusKeys.map((k) => ({ key: k, label: IMPORT_ROW_STATUS[k].label, href: withParams(path, sp, { status: k, page: null }), count: counts[k as keyof typeof counts] })),
  ]

  const table = (
    <Card className="overflow-hidden">
      <CardHeader
        title={completed ? 'نتيجة كل صف' : 'المعاينة والتحقق'}
        description={completed ? 'الصفوف التي لم تُستورد مع السبب.' : 'القيم كما ستُحفظ بعد التنظيف. القيم المشطوبة بالأحمر مرفوضة (انظر الملاحظات).'}
      />
      <LinkTabs tabs={tabs} active={status} className="px-3" />
      {pageRows.length === 0 ? (
        <EmptyState title="لا توجد صفوف بهذه الحالة" />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>الصف</TH>
                <TH>الحالة</TH>
                {mappedFields.map((x) => (
                  <TH key={x.key}>{x.label}</TH>
                ))}
                <TH>رسائل التحقق</TH>
              </tr>
            </THead>
            <tbody>
              {pageRows.map((r) => {
                const raw = rawByRow.get(r.rowNumber) ?? []
                const values = r.values ?? {}
                return (
                  <TR key={r.rowNumber} className={r.status === 'error' ? 'bg-rose-50/40' : r.status === 'duplicate' ? 'bg-amber-50/40' : undefined}>
                    <TD className="num text-slate-500">{r.rowNumber}</TD>
                    <TD>
                      <StatusBadge map={IMPORT_ROW_STATUS} value={r.status} />
                    </TD>
                    {mappedFields.map((x) => (
                      <TD key={x.key} className="whitespace-nowrap">
                        {x.key === 'student' && values.studentName ? (
                          <span>
                            {String(values.studentName)}
                            <span className="ms-1 text-xs text-slate-400">
                              (<bdi>{String(values.student)}</bdi>)
                            </span>
                          </span>
                        ) : (
                          <ImportCellValue kind={x.kind} value={values[x.key]} raw={raw[s.mapping[x.key]!]} f={f} />
                        )}
                      </TD>
                    ))}
                    <TD className="min-w-64 text-xs leading-5">
                      {r.messages.length ? (
                        <ul className={r.status === 'error' ? 'text-rose-700' : r.status === 'duplicate' ? 'text-amber-800' : 'text-slate-600'}>
                          {r.messages.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      ) : null}
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <Pagination path={path} params={sp} page={page} pages={pages} total={filtered.length} pageSize={PAGE_SIZE} />
    </Card>
  )

  const header = (
    <PageHeader
      title={`استيراد ${s.def.label}`}
      breadcrumbs={[{ label: 'استيراد Excel', href: '/import' }, { label: s.fileName }]}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <FileSpreadsheet className="size-4 text-slate-400" />
          <bdi>{s.fileName}</bdi>
          <span className="text-slate-300">·</span>
          <span>
            <bdi className="num">{s.file.rows.length}</bdi> صف
          </span>
          <span className="text-slate-300">·</span>
          {f.dateTime(s.createdAt)}
          <StatusBadge map={IMPORT_STATUS} value={s.status} />
        </span>
      }
    />
  )

  if (completed) {
    const link = RESULT_LINKS[s.def.key]
    return (
      <>
        {header}
        <ImportSteps current={6} />
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="سجلات جديدة" value={f.number(stored.created ?? 0)} accent="green" />
          <StatCard label="سجلات محدّثة" value={f.number(stored.updated ?? 0)} />
          <StatCard label="صفوف متجاهلة (مكررة)" value={f.number(s.counts.skippedRows)} accent="amber" />
          <StatCard label="صفوف بها أخطاء" value={f.number(s.counts.errorRows)} accent="red" />
        </div>
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">تم الاستيراد بنجاح {s.completedAt ? <>بتاريخ {f.dateTime(s.completedAt)}</> : null}</p>
              <p className="text-sm text-slate-500">كل سجل مستورد يحمل رقم دفعة الاستيراد <bdi className="num">#{s.id}</bdi>، والعملية مسجلة في سجل النشاط.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {link ? (
                <Link href={link.href} className="inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-[15px] font-medium text-white hover:bg-brand-700">
                  عرض {link.label}
                </Link>
              ) : null}
              <a href={`/api/import/${s.id}/errors?all=1`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                <Download className="size-4" />
                تقرير النتيجة
              </a>
              <Link href="/import" className="inline-flex h-10 items-center rounded-xl px-4 text-[15px] font-medium text-slate-600 hover:bg-slate-100">
                استيراد ملف آخر
              </Link>
            </div>
          </CardBody>
          {stored.notes?.length ? (
            <ul className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
              {stored.notes.map((n, i) => (
                <li key={i}>• {n}</li>
              ))}
            </ul>
          ) : null}
        </Card>
        {table}
      </>
    )
  }

  // عينات لكل عمود (أول 3 قيم غير فارغة) لمعاينة الربط مباشرة
  const samples = s.file.headers.map((_, col) => {
    const out: string[] = []
    for (const row of s.file.rows) {
      const c = row[col]
      if (c !== null && c !== undefined && String(c).trim() !== '') out.push(String(c).trim().slice(0, 40))
      if (out.length >= 3) break
    }
    return out
  })
  const lastError = typeof (s.result as StoredResult | null)?.lastError === 'string' ? (s.result as StoredResult).lastError! : null

  return (
    <>
      {header}
      <ImportSteps current={4} />
      <ImportWorkspace
        batchId={s.id}
        typeLabel={s.def.label}
        fields={s.def.fields.map((x) => ({ key: x.key, label: x.label, required: !!x.required, help: [KIND_HELP[x.kind], x.hint].filter(Boolean).join(' — ') }))}
        headers={s.file.headers}
        samples={samples}
        mapping={s.mapping}
        options={s.options}
        flags={{ supportsUpdate: !!s.def.supportsUpdate, supportsCreateMissing: !!s.def.supportsCreateMissing, needsYear: !!s.def.needsYear, needsCashAccount: !!s.def.needsCashAccount }}
        years={years.map((y) => ({ id: y.id, name: y.name, open: y.status === 'OPEN' }))}
        cashAccounts={cash}
        summary={{ total: outcome.length, valid: counts.valid, duplicate: counts.duplicate, error: counts.error, toCreate: counts.valid, toUpdate }}
        lastError={lastError}
      >
        {table}
        <details className="card mt-5 overflow-hidden">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-700">الملف كما هو (أول 10 صفوف)</summary>
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>الصف</TH>
                  {s.file.headers.map((h, i) => (
                    <TH key={i}>{h || '(بدون عنوان)'}</TH>
                  ))}
                </tr>
              </THead>
              <tbody>
                {s.file.rows.slice(0, 10).map((row, i) => (
                  <TR key={i}>
                    <TD className="num text-slate-500">{s.file.rowNumbers[i]}</TD>
                    {s.file.headers.map((_, c) => (
                      <TD key={c} className="whitespace-nowrap">
                        <bdi>{row[c] === null || row[c] === undefined ? '' : String(row[c])}</bdi>
                      </TD>
                    ))}
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </details>
      </ImportWorkspace>
    </>
  )
}
