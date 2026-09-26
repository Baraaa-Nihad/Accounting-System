import 'server-only'
import { db } from '../db'
import { listGradesWithSections } from './school'
import { listYears } from '../years'

/** بيانات القوائم المنسدلة المشتركة للنماذج. */
export async function studentFormLookups() {
  const [grades, years, feePlans] = await Promise.all([
    listGradesWithSections(db, { activeOnly: true }),
    listYears(db),
    db.feePlan.findMany({ where: { isActive: true }, include: { chargeType: true } }),
  ])
  return {
    grades: grades.map((g) => ({ id: g.id, name: g.name, sections: g.sections.map((s) => ({ id: s.id, name: s.name })) })),
    years: years.map((y) => ({ id: y.id, name: y.name, status: y.status, isCurrent: y.isCurrent })),
    feePlans: feePlans.map((p) => ({
      academicYearId: p.academicYearId,
      gradeId: p.gradeId,
      chargeTypeName: p.chargeType.name,
      amount: p.amount.toString(),
      installmentsCount: p.installmentsCount,
    })),
  }
}
