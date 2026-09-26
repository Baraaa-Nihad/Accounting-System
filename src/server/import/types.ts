import type { Permission } from '@/lib/permissions'
import type { Cell } from '@/lib/import-normalize'
import type { DateOnly } from '@/lib/dates'
import type { Tx } from '../db'
import type { Ctx } from '../context'
import type { Settings } from '../settings'
import type { Lookups } from './lookups'

/**
 * نظام الاستيراد من Excel (docs/12-excel-import.md): كل نوع يعرّف حقوله مرة واحدة،
 * والمحرك يتولى القالب والقراءة وربط الأعمدة والتنظيف والمعاينة والتأكيد.
 */

export type FieldKind =
  | 'text'
  | 'amount'
  | 'signedAmount'
  | 'integer'
  | 'date'
  | 'phone'
  | 'bool'
  | 'gender'
  | 'studentStatus'
  | 'salaryType'
  | 'paymentMethod'
  | 'discount'

export interface ImportField {
  key: string
  label: string
  kind: FieldKind
  required?: boolean
  synonyms?: string[]
  hint?: string
  example?: string | number
}

export type RowStatus = 'valid' | 'duplicate' | 'error'

/** صف بعد التنظيف حسب نوع كل حقل. */
export interface NormalizedRow {
  rowNumber: number
  values: Record<string, unknown>
  errors: string[]
}

export interface ValidatedRow {
  rowNumber: number
  status: RowStatus
  messages: string[]
  values: Record<string, unknown>
  /** معرف السجل الموجود عند التكرار (للتحديث) */
  existingId?: number | null
  /** مفتاح التجميع (الأقساط: الطالب + نوع الذمة) */
  groupKey?: string
}

export interface ImportOptions {
  yearId: number | null
  duplicates: 'skip' | 'update'
  createMissing: boolean
  cashAccountId: number | null
}

export interface ImportEnv {
  settings: Settings
  today: DateOnly
  lookups: Lookups
  options: ImportOptions
}

export interface CommitResult {
  created: number
  updated: number
  skipped: number
  notes: string[]
}

export interface ImportTypeDef {
  key: string
  label: string
  description: string
  /** صلاحية إنشاء النوع (أي منها) إضافة إلى import.excel */
  permissions: Permission[]
  fields: ImportField[]
  supportsUpdate?: boolean
  supportsCreateMissing?: boolean
  needsYear?: boolean
  needsCashAccount?: boolean
  /** ملاحظات تظهر في ورقة التعليمات */
  instructions?: string[]
  validate: (rows: NormalizedRow[], env: ImportEnv) => Promise<ValidatedRow[]>
  commit: (tx: Tx, ctx: Ctx, rows: ValidatedRow[], env: ImportEnv & { batchId: number }) => Promise<CommitResult>
}

export interface ParsedFile {
  headers: string[]
  rows: Cell[][]
  /** رقم كل صف في ملف Excel الأصلي (لرسائل الأخطاء) */
  rowNumbers: number[]
}
