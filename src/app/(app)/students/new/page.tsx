import { requirePermission } from '@/server/auth/guard'
import { PageHeader } from '@/components/ui/page-header'
import { StudentForm } from '@/components/students/student-form'
import { studentFormLookups } from '@/server/services/lookups'
import { getSelectedYear } from '@/server/context-year'

export const metadata = { title: 'إضافة طالب' }

export default async function NewStudentPage() {
  await requirePermission('students.create')
  const [lookups, year] = await Promise.all([studentFormLookups(), getSelectedYear()])
  const openYear = year?.status === 'OPEN' ? year : null
  return (
    <>
      <PageHeader
        title="إضافة طالب جديد"
        description="أدخل بيانات الطالب وولي أمره والصف. يمكن إضافة الرسوم المقررة للصف في نفس الخطوة."
        breadcrumbs={[{ label: 'الطلاب', href: '/students' }, { label: 'إضافة طالب' }]}
      />
      <StudentForm
        mode="create"
        grades={lookups.grades}
        years={lookups.years}
        feePlans={lookups.feePlans}
        initial={{
          fullName: '',
          schoolNumber: '',
          gender: '',
          birthDate: '',
          nationalId: '',
          joinDate: '',
          address: '',
          notes: '',
          academicYearId: String(openYear?.id ?? lookups.years.find((y) => y.status === 'OPEN')?.id ?? ''),
          gradeId: '',
          sectionId: '',
          guardianId: null,
          guardianLabel: '',
          guardian: { name: '', phone: '', phone2: '', relation: '', nationalId: '' },
        }}
      />
    </>
  )
}
