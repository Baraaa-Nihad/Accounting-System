import { requirePermission, can } from '@/server/auth/guard'
import { db } from '@/server/db'
import { cashAccountsSummary } from '@/server/services/treasury'
import { listSuppliers } from '@/server/services/parties'
import { expenseCategories, freePostingAccounts } from '@/server/ledger/accounts'
import { PageHeader } from '@/components/ui/page-header'
import { VoucherForm, type VoucherFormData, type VoucherFormKind } from '@/components/vouchers/voucher-form'
import { D } from '@/lib/money'
import { firstParam, intParam } from '@/lib/utils'

export const metadata = { title: 'سند صرف جديد' }

export default async function NewVoucherPage({ searchParams }: PageProps<'/vouchers/new'>) {
  const user = await requirePermission('vouchers.create')
  const sp = await searchParams
  const kinds: VoucherFormKind[] = ['EXPENSE', 'SUPPLIER_PAYMENT', 'CONTRACTOR_PAYMENT']
  if (can(user, 'payroll.pay')) kinds.push('SALARY')
  kinds.push('STUDENT_REFUND', 'PARTNER_WITHDRAWAL')
  if (can(user, 'accounting.manage')) kinds.push('OTHER')
  const requested = firstParam(sp.kind) as VoucherFormKind | undefined
  const initialKind = requested && kinds.includes(requested) ? requested : 'EXPENSE'
  const studentId = intParam(sp.studentId)

  const [cash, expenses, suppliers, jobs, partners, payrollItems, otherAccounts, student] = await Promise.all([
    cashAccountsSummary(db),
    expenseCategories(db),
    listSuppliers(db, { active: true, pageSize: 1000 }),
    db.contractorJob.findMany({ where: { status: { not: 'CANCELLED' } }, include: { contractor: true }, orderBy: [{ contractor: { name: 'asc' } }, { startDate: 'desc' }] }),
    db.partner.findMany({ where: { isActive: true, drawingsAccountId: { not: null } }, orderBy: { name: 'asc' } }),
    can(user, 'payroll.pay')
      ? db.payrollItem.findMany({
          where: { payrollRun: { status: 'APPROVED' }, paymentStatus: { not: 'PAID' } },
          include: { employee: true, payrollRun: true },
          orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }, { employee: { fullName: 'asc' } }],
        })
      : [],
    can(user, 'accounting.manage') ? freePostingAccounts(db) : [],
    studentId ? db.student.findUnique({ where: { id: studentId }, include: { guardian: true } }) : null,
  ])
  const data: VoucherFormData = {
    kinds,
    cashAccounts: cash.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, type: c.type, balance: c.balance, isDefault: c.isDefault })),
    expenseAccounts: expenses.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    suppliers: suppliers.rows.map((s) => ({ id: s.id, name: s.name, balance: D(s.balance).toString() })),
    jobs: jobs
      .map((j) => ({
        id: j.id,
        contractorId: j.contractorId,
        contractorName: j.contractor.name,
        description: j.description,
        agreed: j.agreedAmount.toString(),
        paid: j.paidAmount.toString(),
        remaining: D(j.agreedAmount).minus(D(j.paidAmount)).toString(),
      }))
      .filter((j) => D(j.remaining).greaterThan(0)),
    partners: partners.map((p) => ({ id: p.id, name: p.name })),
    payrollItems: payrollItems
      .map((p) => ({
        id: p.id,
        label: p.employee.fullName,
        runLabel: `${p.payrollRun.month}/${p.payrollRun.year}`,
        remaining: D(p.netPay).minus(D(p.paidAmount)).toString(),
      }))
      .filter((p) => D(p.remaining).greaterThan(0)),
    otherAccounts: otherAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
  }
  return (
    <>
      <PageHeader
        title="سند صرف جديد"
        description="اختر نوع الصرف ثم أدخل المبلغ. يُتحقق من كفاية رصيد الصندوق قبل الحفظ."
        breadcrumbs={[{ label: 'سندات الصرف', href: '/vouchers' }, { label: 'سند جديد' }]}
      />
      <VoucherForm
        data={data}
        initialKind={initialKind}
        initialSupplierId={intParam(sp.supplierId) ?? null}
        initialJobId={intParam(sp.jobId) ?? null}
        initialPayrollItemId={intParam(sp.payrollItemId) ?? null}
        initialStudent={
          student ? { id: student.id, fullName: student.fullName, studentNumber: student.studentNumber, guardianName: student.guardian?.name ?? null } : null
        }
      />
    </>
  )
}
