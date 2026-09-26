import { notFound, redirect } from 'next/navigation'
import { requirePermission } from '@/server/auth/guard'
import { db } from '@/server/db'

/** رابط العمل من كشوف الحساب: يفتح ملف المتعامل على تبويب الأعمال مع إبراز العمل. */
export default async function JobRedirect({ params }: PageProps<'/contractors/jobs/[id]'>) {
  await requirePermission('contractors.view')
  const { id } = await params
  const job = await db.contractorJob.findUnique({ where: { id: Number(id) }, select: { id: true, contractorId: true } })
  if (!job) notFound()
  redirect(`/contractors/${job.contractorId}?tab=jobs&job=${job.id}`)
}
