import { notFound } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { PageHeader } from '@/components/ui/page-header'
import { StudentForm } from '@/components/students/student-form'
import { studentFormLookups } from '@/server/services/lookups'
import { getStudentProfile } from '@/server/services/students'
import { getSelectedYear } from '@/server/context-year'
import { db } from '@/server/db'
import { toDateOnly } from '@/lib/dates'

export const metadata = { title: 'تعديل طالب' }

export default async function EditStudentPage({ params }: PageProps<'/students/[id]/edit'>) {
  await requirePermission('students.edit')
  const { id } = await params
  const student = await getStudentProfile(db, Number(id))
  if (!student) notFound()
  const [lookups, selected] = await Promise.all([studentFormLookups(), getSelectedYear()])
  const enrollment = student.enrollments.find((e) => e.academicYearId === selected?.id) ?? student.enrollments[0]
  return (
    <>
      <PageHeader
        title={`تعديل بيانات: ${student.fullName}`}
        breadcrumbs={[
          { label: 'الطلاب', href: '/students' },
          { label: student.fullName, href: `/students/${student.id}` },
          { label: 'تعديل' },
        ]}
      />
      <StudentForm
        mode="edit"
        studentId={student.id}
        grades={lookups.grades}
        years={lookups.years}
        feePlans={lookups.feePlans}
        initial={{
          fullName: student.fullName,
          schoolNumber: student.schoolNumber ?? '',
          gender: student.gender ?? '',
          birthDate: student.birthDate ? toDateOnly(student.birthDate) : '',
          nationalId: student.nationalId ?? '',
          joinDate: student.joinDate ? toDateOnly(student.joinDate) : '',
          address: student.address ?? '',
          notes: student.notes ?? '',
          academicYearId: String(enrollment?.academicYearId ?? selected?.id ?? ''),
          gradeId: String(enrollment?.gradeId ?? ''),
          sectionId: enrollment?.sectionId ? String(enrollment.sectionId) : '',
          guardianId: student.guardianId,
          guardianLabel: student.guardian ? `${student.guardian.name}${student.guardian.phone ? ` · ${student.guardian.phone}` : ''}` : '',
          guardian: { name: '', phone: '', phone2: '', relation: '', nationalId: '' },
        }}
      />
    </>
  )
}
