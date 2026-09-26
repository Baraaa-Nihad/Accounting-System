import Link from 'next/link'
import { FilePlus2, Layers, ClipboardList } from 'lucide-react'
import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { getFormatConfig } from '@/server/settings'
import { getSelectedYear } from '@/server/context-year'
import { listCharges, listDiscounts, listInstallments, type DuePeriod } from '@/server/services/charges-queries'
import { chargeTypesList, discountTypesList } from '@/server/services/charges'
import { listGradesWithSections } from '@/server/services/school'
import { makeFormatters } from '@/lib/format-jsx'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { LinkTabs } from '@/components/ui/link-tabs'
import { FilterBar } from '@/components/ui/filter-bar'
import { Table, TableWrap, TD, TH, THead, TR, TFootRow } from '@/components/ui/table'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/pagination'
import { StatCard } from '@/components/ui/stat-card'
import { DiscountCancelButton } from '@/components/charges/discount-cancel-button'
import { DISCOUNT_METHOD, DISCOUNT_SCOPE, DOC_STATUS, INSTALLMENT_DISPLAY, PAYMENT_STATUS } from '@/lib/labels'
import { installmentDisplayStatus } from '@/lib/schedule'
import { firstParam, intParam } from '@/lib/utils'
import { isDateOnly, toDateOnly } from '@/lib/dates'
import { D } from '@/lib/money'

export const metadata = { title: 'الذمم والأقساط' }

const PERIODS: { key: DuePeriod; label: string }[] = [
  { key: 'today', label: 'المستحقة اليوم' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'due', label: 'كل المستحق حتى اليوم' },
  { key: 'upcoming', label: 'القادمة' },
]

export default async function ChargesPage({ searchParams }: PageProps<'/charges'>) {
  const user = await requirePermission('charges.view')
  const sp = await searchParams
  const tab = (['list', 'due', 'overdue', 'discounts'] as const).find((t) => t === firstParam(sp.tab)) ?? 'list'
  const [fmt, year, chargeTypes, discountTypes, grades, users] = await Promise.all([
    getFormatConfig(),
    getSelectedYear(),
    chargeTypesList(db, false),
    discountTypesList(db, false),
    listGradesWithSections(db),
    db.user.findMany({ select: { id: true, fullName: true } }),
  ])
  const f = makeFormatters(fmt)
  const yearId = intParam(sp.year) ?? year?.id
  const gradeId = intParam(sp.grade)
  const grade = grades.find((g) => g.id === gradeId)
  const from = isDateOnly(firstParam(sp.from)) ? firstParam(sp.from) : undefined
  const to = isDateOnly(firstParam(sp.to)) ? firstParam(sp.to) : undefined

  const tabs = [
    { key: 'list', label: 'الذمم', href: '/charges' },
    { key: 'due', label: 'المستحقات', href: '/charges?tab=due&period=today' },
    { key: 'overdue', label: 'المتأخرة', href: '/charges?tab=overdue' },
    { key: 'discounts', label: 'الخصومات', href: '/charges?tab=discounts' },
  ]

  return (
    <>
      <PageHeader
        title="الذمم والأقساط"
        description="الذمة = مبلغ مطلوب من الطالب. هنا تتابع كل الذمم، والأقساط المستحقة والمتأخرة، والخصومات الممنوحة."
        actions={
          <>
            {can(user, 'feeplans.manage') ? (
              <Button variant="secondary" asChild>
                <Link href="/charges/fee-plans">
                  <ClipboardList />
                  الرسوم المقررة
                </Link>
              </Button>
            ) : null}
            {can(user, 'charges.create') ? (
              <>
                <Button variant="secondary" asChild>
                  <Link href="/charges/bulk">
                    <Layers />
                    إصدار ذمم جماعية
                  </Link>
                </Button>
                <Button size="lg" asChild>
                  <Link href="/charges/new">
                    <FilePlus2 />
                    إضافة ذمة
                  </Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <LinkTabs className="mb-5" active={tab} tabs={tabs} />

      {tab === 'list'
        ? await (async () => {
            const data = await listCharges({
              q: firstParam(sp.q),
              yearId,
              chargeTypeId: intParam(sp.type),
              gradeId,
              sectionId: intParam(sp.section),
              status: firstParam(sp.status) ?? 'ACTIVE',
              paymentStatus: firstParam(sp.pay),
              from,
              to,
              userId: intParam(sp.user),
              minAmount: firstParam(sp.min),
              maxAmount: firstParam(sp.max),
              page: intParam(sp.page),
            })
            return (
              <>
                <div className="mb-5 grid gap-4 sm:grid-cols-4">
                  <StatCard label="إجمالي الذمم" value={f.money(data.sums.gross)} />
                  <StatCard label="الخصومات" value={f.money(data.sums.discount)} accent="blue" />
                  <StatCard label="المدفوع" value={f.money(data.sums.paid)} accent="green" />
                  <StatCard label="المتبقي" value={f.money(D(data.sums.net).minus(D(data.sums.paid)))} accent="amber" />
                </div>
                <div className="card overflow-hidden">
                  <FilterBar
                    fields={[
                      { type: 'search', name: 'q', placeholder: 'اسم الطالب أو رقمه' },
                      { type: 'select', name: 'type', label: 'نوع الذمة', options: chargeTypes.map((t) => ({ value: String(t.id), label: t.name })) },
                      { type: 'select', name: 'grade', label: 'الصف', options: grades.map((g) => ({ value: String(g.id), label: g.name })) },
                      ...(grade ? [{ type: 'select' as const, name: 'section', label: 'الشعبة', options: grade.sections.map((s) => ({ value: String(s.id), label: s.name })) }] : []),
                      { type: 'select', name: 'pay', label: 'حالة السداد', options: Object.entries(PAYMENT_STATUS).map(([k, v]) => ({ value: k, label: v.label })) },
                      { type: 'select', name: 'status', label: 'الحالة', allLabel: 'الفعالة', options: [{ value: 'CANCELLED', label: 'الملغاة' }] },
                      { type: 'date', name: 'from', label: 'من تاريخ' },
                      { type: 'date', name: 'to', label: 'إلى تاريخ' },
                      { type: 'select', name: 'user', label: 'المستخدم', options: users.map((u) => ({ value: String(u.id), label: u.fullName })) },
                    ]}
                  />
                  {data.rows.length === 0 ? (
                    <EmptyState title="لا توجد ذمم مطابقة" />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead>
                          <tr>
                            <TH>التاريخ</TH>
                            <TH>الطالب</TH>
                            <TH>نوع الذمة</TH>
                            <TH>السنة</TH>
                            <TH numeric>المبلغ</TH>
                            <TH numeric>الخصم</TH>
                            <TH numeric>المدفوع</TH>
                            <TH numeric>المتبقي</TH>
                            <TH>الحالة</TH>
                          </tr>
                        </THead>
                        <tbody>
                          {data.rows.map((c) => (
                            <TR key={c.id} className={c.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                              <TD>{f.date(c.date)}</TD>
                              <TD>
                                <Link href={`/students/${c.student.id}`} className="font-medium hover:text-brand-700">
                                  {c.student.fullName}
                                </Link>
                              </TD>
                              <TD>
                                <Link href={`/charges/${c.id}`} className="hover:text-brand-700">
                                  {c.chargeType.name}
                                </Link>
                                {c.installmentCount > 1 ? <span className="text-xs text-slate-500"> ({c.installmentCount} أقساط)</span> : null}
                              </TD>
                              <TD className="text-slate-500">
                                <bdi className="ltr num">{c.academicYear.name}</bdi>
                              </TD>
                              <TD numeric>{f.money(c.grossAmount)}</TD>
                              <TD numeric className="text-emerald-700">
                                {f.money(c.discountAmount, { hideZero: true })}
                              </TD>
                              <TD numeric>{f.money(c.paidAmount, { hideZero: true })}</TD>
                              <TD numeric className="font-semibold">
                                {c.status === 'CANCELLED' ? '—' : f.money(D(c.netAmount).minus(D(c.paidAmount)), { hideZero: true })}
                              </TD>
                              <TD>
                                {c.status === 'CANCELLED' ? <Badge tone="gray">ملغاة</Badge> : <StatusBadge map={PAYMENT_STATUS} value={c.paymentStatus} />}
                              </TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrap>
                  )}
                  <Pagination path="/charges" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
                </div>
              </>
            )
          })()
        : null}

      {tab === 'due' || tab === 'overdue'
        ? await (async () => {
            const period: DuePeriod = tab === 'overdue' ? 'overdue' : (PERIODS.find((p) => p.key === firstParam(sp.period))?.key ?? 'today')
            const data = await listInstallments({
              period,
              yearId: intParam(sp.year),
              gradeId,
              sectionId: intParam(sp.section),
              chargeTypeId: intParam(sp.type),
              q: firstParam(sp.q),
              page: intParam(sp.page),
            })
            return (
              <>
                {tab === 'due' ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {PERIODS.map((p) => (
                      <Link
                        key={p.key}
                        href={`/charges?tab=due&period=${p.key}`}
                        className={
                          p.key === period
                            ? 'rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white'
                            : 'rounded-full bg-white px-4 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                        }
                      >
                        {p.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
                <div className="mb-5 grid gap-4 sm:grid-cols-3">
                  <StatCard label="عدد الطلاب" value={f.number(data.students)} />
                  <StatCard label="عدد الأقساط" value={f.number(data.total)} />
                  <StatCard label={tab === 'overdue' ? 'إجمالي المتأخر' : 'إجمالي المستحق'} value={f.money(data.remaining)} accent={tab === 'overdue' ? 'red' : 'amber'} emphasis />
                </div>
                <div className="card overflow-hidden">
                  <FilterBar
                    fields={[
                      { type: 'search', name: 'q', placeholder: 'اسم الطالب أو رقمه أو هاتف ولي الأمر' },
                      { type: 'select', name: 'grade', label: 'الصف', options: grades.map((g) => ({ value: String(g.id), label: g.name })) },
                      ...(grade ? [{ type: 'select' as const, name: 'section', label: 'الشعبة', options: grade.sections.map((s) => ({ value: String(s.id), label: s.name })) }] : []),
                      { type: 'select', name: 'type', label: 'نوع الذمة', options: chargeTypes.map((t) => ({ value: String(t.id), label: t.name })) },
                    ]}
                  />
                  {data.rows.length === 0 ? (
                    <EmptyState title={tab === 'overdue' ? 'لا توجد أقساط متأخرة 👍' : 'لا توجد أقساط مستحقة في هذه الفترة'} />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead>
                          <tr>
                            <TH>الطالب</TH>
                            <TH>الصف</TH>
                            <TH>ولي الأمر</TH>
                            <TH>الذمة</TH>
                            <TH>الاستحقاق</TH>
                            <TH numeric>القيمة</TH>
                            <TH numeric>المدفوع</TH>
                            <TH numeric>المتبقي</TH>
                            <TH>الحالة</TH>
                          </tr>
                        </THead>
                        <tbody>
                          {data.rows.map((i) => {
                            const st = installmentDisplayStatus({ status: i.status, dueDate: toDateOnly(i.dueDate), amount: i.amount, paidAmount: i.paidAmount }, data.today, data.graceDays)
                            return (
                              <TR key={i.id}>
                                <TD>
                                  <Link href={`/students/${i.studentId}`} className="font-medium hover:text-brand-700">
                                    {i.studentName}
                                  </Link>
                                  <span className="block text-xs text-slate-500">رقم {i.studentNumber}</span>
                                </TD>
                                <TD className="text-slate-600">{i.gradeName ? `${i.gradeName}${i.sectionName ? ` - ${i.sectionName}` : ''}` : '—'}</TD>
                                <TD className="text-slate-600">
                                  {i.guardianName}
                                  {i.guardianPhone ? (
                                    <a href={`tel:${i.guardianPhone}`} className="block text-xs text-brand-700">
                                      <bdi className="ltr num">{i.guardianPhone}</bdi>
                                    </a>
                                  ) : null}
                                </TD>
                                <TD>
                                  {i.chargeTypeName}
                                  {i.installmentCount > 1 ? <span className="text-xs text-slate-500"> — القسط {i.number}</span> : null}
                                </TD>
                                <TD>{f.date(i.dueDate)}</TD>
                                <TD numeric>{f.money(i.amount)}</TD>
                                <TD numeric>{f.money(i.paidAmount, { hideZero: true })}</TD>
                                <TD numeric className="font-semibold">
                                  {f.money(i.remaining)}
                                </TD>
                                <TD>
                                  <StatusBadge map={INSTALLMENT_DISPLAY} value={st} />
                                </TD>
                              </TR>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <TFootRow>
                            <TD colSpan={5}>الإجمالي</TD>
                            <TD numeric>{f.money(data.amount)}</TD>
                            <TD numeric>{f.money(data.paid)}</TD>
                            <TD numeric>{f.money(data.remaining)}</TD>
                            <TD />
                          </TFootRow>
                        </tfoot>
                      </Table>
                    </TableWrap>
                  )}
                  <Pagination path="/charges" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
                </div>
              </>
            )
          })()
        : null}

      {tab === 'discounts'
        ? await (async () => {
            const data = await listDiscounts({
              q: firstParam(sp.q),
              yearId: intParam(sp.year),
              discountTypeId: intParam(sp.dtype),
              status: firstParam(sp.status),
              from,
              to,
              userId: intParam(sp.user),
              page: intParam(sp.page),
            })
            return (
              <>
                <div className="mb-5 grid gap-4 sm:grid-cols-2">
                  <StatCard label="عدد الخصومات" value={f.number(data.total)} />
                  <StatCard label="إجمالي الخصومات الفعالة" value={f.money(data.sumAmount)} accent="blue" />
                </div>
                <div className="card overflow-hidden">
                  <FilterBar
                    fields={[
                      { type: 'search', name: 'q', placeholder: 'اسم الطالب' },
                      { type: 'select', name: 'dtype', label: 'نوع الخصم', options: discountTypes.map((t) => ({ value: String(t.id), label: t.name })) },
                      { type: 'select', name: 'status', label: 'الحالة', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'CANCELLED', label: 'ملغي' }] },
                      { type: 'date', name: 'from', label: 'من تاريخ' },
                      { type: 'date', name: 'to', label: 'إلى تاريخ' },
                      { type: 'select', name: 'user', label: 'المستخدم', options: users.map((u) => ({ value: String(u.id), label: u.fullName })) },
                    ]}
                  />
                  {data.rows.length === 0 ? (
                    <EmptyState title="لا توجد خصومات" />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead>
                          <tr>
                            <TH>التاريخ</TH>
                            <TH>الطالب</TH>
                            <TH>نوع الخصم</TH>
                            <TH>على</TH>
                            <TH>الطريقة</TH>
                            <TH numeric>قبل الخصم</TH>
                            <TH numeric>قيمة الخصم</TH>
                            <TH numeric>بعد الخصم</TH>
                            <TH>السبب / الموافقة</TH>
                            <TH>الحالة</TH>
                            <TH />
                          </tr>
                        </THead>
                        <tbody>
                          {data.rows.map((d) => (
                            <TR key={d.id} className={d.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                              <TD>{f.date(d.date)}</TD>
                              <TD>
                                <Link href={`/students/${d.student.id}`} className="font-medium hover:text-brand-700">
                                  {d.student.fullName}
                                </Link>
                              </TD>
                              <TD>{d.discountType?.name ?? '—'}</TD>
                              <TD className="text-slate-600">
                                {DISCOUNT_SCOPE[d.scope]}
                                {d.charge ? `: ${d.charge.chargeType.name}` : d.chargeType ? `: ${d.chargeType.name}` : ''}
                              </TD>
                              <TD>{d.method === 'PERCENT' ? `${D(d.value).toString()}%` : DISCOUNT_METHOD.FIXED}</TD>
                              <TD numeric>{f.money(d.baseAmount)}</TD>
                              <TD numeric className="font-semibold text-emerald-700">
                                {f.money(d.amount)}
                              </TD>
                              <TD numeric>{f.money(d.netAmount)}</TD>
                              <TD className="max-w-56 text-slate-600">
                                {d.reason}
                                {d.approvedBy ? <span className="block text-xs text-slate-400">بموافقة: {d.approvedBy}</span> : null}
                                <span className="block text-xs text-slate-400">أدخله: {d.createdBy?.fullName}</span>
                              </TD>
                              <TD>
                                <StatusBadge map={DOC_STATUS} value={d.status} />
                              </TD>
                              <TD>{d.status === 'ACTIVE' && can(user, 'discounts.cancel') ? <DiscountCancelButton discountId={d.id} /> : null}</TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrap>
                  )}
                  <Pagination path="/charges" params={sp} page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} />
                </div>
              </>
            )
          })()
        : null}
    </>
  )
}
