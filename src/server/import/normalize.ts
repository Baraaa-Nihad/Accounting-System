import 'server-only'
import {
  cleanText,
  parseAmount,
  parseBool,
  parseDate,
  parseDiscount,
  parseGender,
  parseInteger,
  parsePaymentMethod,
  parsePhone,
  parseSalaryType,
  parseStudentStatus,
  type Cell,
  type Parsed,
} from '@/lib/import-normalize'
import type { ImportField, ImportTypeDef, NormalizedRow, ParsedFile } from './types'

function parseByKind(field: ImportField, cell: Cell, dialCode: string): Parsed<unknown> {
  switch (field.kind) {
    case 'text':
      return { value: cleanText(cell) }
    case 'amount':
      return parseAmount(cell)
    case 'signedAmount':
      return parseAmount(cell, { allowNegative: true })
    case 'integer':
      return parseInteger(cell, 0, 1000)
    case 'date':
      return parseDate(cell)
    case 'phone':
      return parsePhone(cell, dialCode)
    case 'bool':
      return parseBool(cell)
    case 'gender':
      return parseGender(cell)
    case 'studentStatus':
      return parseStudentStatus(cell)
    case 'salaryType':
      return parseSalaryType(cell)
    case 'paymentMethod':
      return parsePaymentMethod(cell)
    case 'discount':
      return parseDiscount(cell)
  }
}

/**
 * تنظيف كل صف حسب أنواع الحقول: القيم الفارغة = null، والإجبارية الفارغة خطأ.
 * الصفوف الفارغة بالكامل تُتجاهل. رقم الصف = رقمه في ملف Excel الأصلي.
 */
export function normalizeRows(def: ImportTypeDef, file: ParsedFile, mapping: Record<string, number | null>, dialCode: string): NormalizedRow[] {
  const out: NormalizedRow[] = []
  file.rows.forEach((raw, i) => {
    if (raw.every((c) => cleanText(c as string) === null)) return
    const values: Record<string, unknown> = {}
    const errors: string[] = []
    for (const field of def.fields) {
      const idx = mapping[field.key]
      const cell = idx === null || idx === undefined ? null : raw[idx]
      const empty = cleanText(cell as string) === null && typeof cell !== 'number' && typeof cell !== 'boolean'
      if (empty) {
        values[field.key] = null
        if (field.required) errors.push(`«${field.label}» مطلوب`)
        continue
      }
      const parsed = parseByKind(field, cell, dialCode)
      if (parsed.error !== undefined) {
        values[field.key] = null
        errors.push(`«${field.label}»: ${parsed.error}`)
      } else values[field.key] = parsed.value
    }
    out.push({ rowNumber: file.rowNumbers[i] ?? i + 2, values, errors })
  })
  return out
}
