import type { Permission } from '@/lib/permissions'
import type { DateOnly } from '@/lib/dates'
import type { PeriodKey } from '@/lib/period'
import type { ColumnType } from '../export/excel'
import type { CurrentUser } from '../auth/guard'
import type { Settings } from '../settings'

/**
 * محرك التقارير الموحد (docs/01-architecture.md): كل تقرير يُعرّف فلاتره وأعمدته مرة واحدة،
 * فيحصل تلقائيًا على العرض والتصدير (Excel، CSV) والطباعة وPDF.
 */

export type FilterKey =
  | 'period'
  | 'year'
  | 'student'
  | 'grade'
  | 'kind'
  | 'method'
  | 'user'
  | 'amount'
  | 'chargeType'
  | 'account'
  | 'employee'
  | 'supplier'
  | 'status'
  | 'category'
  | 'q'

export interface FilterSpec {
  key: FilterKey
  label?: string
  /** خيارات ثابتة (للنوع والحالة والتصنيف) */
  options?: { value: string; label: string }[]
  /** خيارات تُحمّل من قاعدة البيانات */
  loadOptions?: () => Promise<{ value: string; label: string }[]>
  /** الخيار الافتراضي حين لا يُحدد (للنوع والحالة) */
  defaultValue?: string
  allLabel?: string
  /** للفترة: القالب الافتراضي */
  defaultPeriod?: PeriodKey
  /** للسنة: السماح بـ «كل السنوات» */
  allowAllYears?: boolean
  /** للسنة: «كل السنوات» هو الافتراضي */
  defaultAll?: boolean
  /** للحساب: نوع الصناديق المعروضة */
  accountType?: 'CASHBOX' | 'BANK'
}

export interface ReportFilters {
  periodKey: PeriodKey
  from: DateOnly | null
  to: DateOnly | null
  yearId: number | null
  studentId: number | null
  gradeId: number | null
  kind: string | null
  method: string | null
  userId: number | null
  min: string | null
  max: string | null
  chargeTypeId: number | null
  accountId: number | null
  employeeId: number | null
  supplierId: number | null
  status: string | null
  categoryId: number | null
  q: string | null
}

export type CellValue = string | number | null
export type Row = Record<string, CellValue>

export interface ReportColumn {
  key: string
  header: string
  type?: ColumnType
  width?: number
  /** رابط الخلية في العرض (من حقول الصف) */
  href?: (row: Row) => string | null
  /** يظهر في العرض فقط (لا يُصدر) */
  viewOnly?: boolean
}

export interface SummaryItem {
  label: string
  value: CellValue
  type: 'money' | 'number' | 'percent' | 'text'
  hint?: string
}

export interface Breakdown {
  title: string
  columns: ReportColumn[]
  rows: Row[]
  totals?: Row
}

export interface ReportResult {
  columns: ReportColumn[]
  rows: Row[]
  totals?: Row
  summary?: SummaryItem[]
  breakdowns?: Breakdown[]
  note?: string
}

export type ReportGroup = 'students' | 'documents' | 'pnl' | 'staff' | 'treasury' | 'financial'

export const REPORT_GROUPS: Record<ReportGroup, string> = {
  students: 'الطلاب والتحصيل',
  documents: 'السندات',
  pnl: 'المصروفات والإيرادات',
  staff: 'الموظفون والموردون',
  treasury: 'الخزينة',
  financial: 'التقارير المالية',
}

export interface ReportEnv {
  today: DateOnly
  settings: Settings
  user: CurrentUser
}

export interface ReportDef {
  id: string
  title: string
  description: string
  group: ReportGroup
  /** يكفي امتلاك أي صلاحية منها (إضافة إلى reports.view) */
  permissions: Permission[]
  /** يتطلب الاطلاع على الرواتب */
  salaries?: boolean
  filters: FilterSpec[]
  landscape?: boolean
  run: (f: ReportFilters, env: ReportEnv) => Promise<ReportResult>
}
