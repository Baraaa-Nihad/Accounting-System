import { notFound } from 'next/navigation'
import { requirePermission, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { departments } from '@/server/services/employees'
import { toDateOnly } from '@/lib/dates'
import { PageHeader } from '@/components/ui/page-header'
import { EmployeeForm } from '@/components/employees/employee-form'

export const metadata = { title: 'تعديل موظف' }

export default async function EditEmployeePage({ params }: PageProps<'/employees/[id]/edit'>) {
  const user = await requirePermission('employees.manage')
  const { id } = await params
  const e = await db.employee.findUnique({ where: { id: Number(id) } })
  if (!e) notFound()
  return (
    <>
      <PageHeader
        title={`تعديل: ${e.fullName}`}
        breadcrumbs={[{ label: 'الموظفون والمعلمات', href: '/employees' }, { label: e.fullName, href: `/employees/${e.id}` }, { label: 'تعديل' }]}
      />
      <EmployeeForm
        employeeId={e.id}
        departments={await departments(db)}
        canSeeSalary={canSeeSalaries(user)}
        initial={{
          fullName: e.fullName,
          phone: e.phone ?? '',
          jobTitle: e.jobTitle ?? '',
          department: e.department ?? '',
          isTeacher: e.isTeacher,
          gender: e.gender ?? '',
          nationalId: e.nationalId ?? '',
          hireDate: e.hireDate ? toDateOnly(e.hireDate) : '',
          salaryType: e.salaryType,
          baseSalary: e.baseSalary.toString(),
          overtimeRate: e.overtimeRate?.toString() ?? '',
          bankName: e.bankName ?? '',
          bankAccount: e.bankAccount ?? '',
          iban: e.iban ?? '',
          address: e.address ?? '',
          notes: e.notes ?? '',
        }}
      />
    </>
  )
}
