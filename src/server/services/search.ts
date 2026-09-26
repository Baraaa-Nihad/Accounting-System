import 'server-only'
import { db } from '../db'
import { prepareSearchQuery } from '@/lib/arabic'
import type { Permission } from '@/lib/permissions'

export interface SearchResult {
  type: 'student' | 'guardian' | 'receipt' | 'voucher' | 'employee' | 'supplier' | 'contractor'
  id: number
  title: string
  subtitle?: string
  href: string
}

/** شرط البحث في نص البحث المطبّع (يستخدم فهرس pg_trgm). */
function searchTextWhere(text: string, digits: string) {
  const ors: { searchText: { contains: string } }[] = [{ searchText: { contains: text } }]
  if (digits.length >= 3 && digits !== text) ors.push({ searchText: { contains: digits } })
  return { OR: ors }
}

export async function globalSearch(q: string, permissions: Set<Permission>): Promise<SearchResult[]> {
  const { text, digits } = prepareSearchQuery(q)
  if (!text) return []
  const results: SearchResult[] = []
  const upper = q.trim().toUpperCase()

  const tasks: Promise<void>[] = []

  if (permissions.has('students.view')) {
    tasks.push(
      db.student
        .findMany({
          where: searchTextWhere(text, digits),
          take: 8,
          orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
          include: {
            guardian: { select: { name: true, phone: true } },
            enrollments: { orderBy: { academicYear: { startDate: 'desc' } }, take: 1, include: { grade: true, section: true } },
          },
        })
        .then((rows) => {
          for (const s of rows) {
            const e = s.enrollments[0]
            results.push({
              type: 'student',
              id: s.id,
              title: s.fullName,
              subtitle: [
                `رقم ${s.studentNumber}`,
                e ? `${e.grade.name}${e.section ? ` - ${e.section.name}` : ''}` : null,
                s.guardian?.name ? `ولي الأمر: ${s.guardian.name}` : null,
                s.guardian?.phone ?? null,
              ]
                .filter(Boolean)
                .join(' · '),
              href: `/students/${s.id}`,
            })
          }
        }),
    )
    tasks.push(
      db.guardian
        .findMany({ where: searchTextWhere(text, digits), take: 5, include: { _count: { select: { students: true } } } })
        .then((rows) => {
          for (const g of rows) {
            results.push({
              type: 'guardian',
              id: g.id,
              title: g.name,
              subtitle: [g.phone, `${g._count.students} أبناء`].filter(Boolean).join(' · '),
              href: `/families/${g.id}`,
            })
          }
        }),
    )
  }

  if (permissions.has('receipts.view') && /\d/.test(q)) {
    tasks.push(
      db.receipt
        .findMany({ where: { number: { contains: upper, mode: 'insensitive' } }, take: 5, orderBy: { id: 'desc' } })
        .then((rows) => {
          for (const r of rows) {
            results.push({
              type: 'receipt',
              id: r.id,
              title: r.number,
              subtitle: `${r.payerName}${r.status === 'CANCELLED' ? ' · ملغي' : ''}`,
              href: `/receipts/${r.id}`,
            })
          }
        }),
    )
  }

  if (permissions.has('vouchers.view') && /\d/.test(q)) {
    tasks.push(
      db.paymentVoucher
        .findMany({ where: { number: { contains: upper, mode: 'insensitive' } }, take: 5, orderBy: { id: 'desc' } })
        .then((rows) => {
          for (const v of rows) {
            results.push({
              type: 'voucher',
              id: v.id,
              title: v.number,
              subtitle: `${v.payeeName}${v.status === 'CANCELLED' ? ' · ملغي' : ''}`,
              href: `/vouchers/${v.id}`,
            })
          }
        }),
    )
  }

  if (permissions.has('employees.view')) {
    tasks.push(
      db.employee.findMany({ where: searchTextWhere(text, digits), take: 5 }).then((rows) => {
        for (const e of rows) {
          results.push({
            type: 'employee',
            id: e.id,
            title: e.fullName,
            subtitle: [e.employeeNumber, e.jobTitle, e.phone].filter(Boolean).join(' · '),
            href: `/employees/${e.id}`,
          })
        }
      }),
    )
  }

  if (permissions.has('suppliers.view')) {
    tasks.push(
      db.supplier.findMany({ where: searchTextWhere(text, digits), take: 5 }).then((rows) => {
        for (const s of rows) {
          results.push({
            type: 'supplier',
            id: s.id,
            title: s.name,
            subtitle: [s.category, s.phone].filter(Boolean).join(' · '),
            href: `/suppliers/${s.id}`,
          })
        }
      }),
    )
  }

  if (permissions.has('contractors.view')) {
    tasks.push(
      db.contractor.findMany({ where: searchTextWhere(text, digits), take: 5 }).then((rows) => {
        for (const c of rows) {
          results.push({
            type: 'contractor',
            id: c.id,
            title: c.name,
            subtitle: [c.specialty, c.phone].filter(Boolean).join(' · '),
            href: `/contractors/${c.id}`,
          })
        }
      }),
    )
  }

  await Promise.all(tasks)
  const order = ['student', 'receipt', 'voucher', 'guardian', 'employee', 'supplier', 'contractor']
  return results.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
}
