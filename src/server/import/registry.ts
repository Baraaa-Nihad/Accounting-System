import 'server-only'
import type { CurrentUser } from '../auth/guard'
import type { ImportTypeDef } from './types'
import { employeesImport, studentsImport, suppliersImport, teachersImport } from './defs/people'
import { balancesImport, chargesImport, expensesImport, installmentsImport, receiptsImport, vouchersImport } from './defs/finance'

/** أنواع الاستيراد بالترتيب المقترح للترحيل من نظام سابق. */
export const IMPORT_TYPES: ImportTypeDef[] = [
  studentsImport,
  teachersImport,
  employeesImport,
  balancesImport,
  chargesImport,
  installmentsImport,
  suppliersImport,
  expensesImport,
  receiptsImport,
  vouchersImport,
]

export function getImportType(key: string) {
  return IMPORT_TYPES.find((t) => t.key === key) ?? null
}

export function canImport(user: CurrentUser, def: ImportTypeDef) {
  return user.permissions.has('import.excel') && def.permissions.some((p) => user.permissions.has(p))
}
