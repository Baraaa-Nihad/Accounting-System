import { requirePermission, canSeeSalaries } from '@/server/auth/guard'
import { db } from '@/server/db'
import { departments } from '@/server/services/employees'
import { PageHeader } from '@/components/ui/page-header'
import { EmployeeForm } from '@/components/employees/employee-form'

export const metadata = { title: 'إضافة موظف' }

export default async function NewEmployeePage() {
  const user = await requirePermission('employees.manage')
  return (
    <>
      <PageHeader title="إضافة موظف" description="يأخذ الموظف رقمًا وظيفيًا تلقائيًا." breadcrumbs={[{ label: 'الموظفون والمعلمات', href: '/employees' }, { label: 'موظف جديد' }]} />
      <EmployeeForm departments={await departments(db)} canSeeSalary={canSeeSalaries(user)} />
    </>
  )
}
