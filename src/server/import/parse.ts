import 'server-only'
import ExcelJS from 'exceljs'
import { BusinessError } from '../errors'
import { cleanText, type Cell } from '@/lib/import-normalize'
import { toDateOnly } from '@/lib/dates'
import type { ParsedFile } from './types'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 10_000

/** قيمة خلية ExcelJS كبيانات فقط: الصيغ تُقرأ نتيجتها المخزنة ولا تُنفذ أبدًا. */
function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return toDateOnly(new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())))
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return cellValue((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('text' in v) return String((v as { text: unknown }).text ?? '')
    if ('error' in v) return null
  }
  return String(v)
}

function parseCsv(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: Cell[][] = []
  let row: Cell[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** قراءة ملف xlsx أو csv: أول صف غير فارغ = العناوين، والصفوف الفارغة تُتجاهل. */
export async function parseImportFile(fileName: string, buffer: Buffer): Promise<ParsedFile> {
  if (buffer.length > MAX_IMPORT_BYTES) throw new BusinessError('حجم الملف أكبر من 10MB')
  const lower = fileName.toLowerCase()
  let grid: Cell[][]
  let numbers: number[]
  if (lower.endsWith('.csv')) {
    grid = parseCsv(buffer.toString('utf8'))
    numbers = grid.map((_, i) => i + 1)
  } else if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook()
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    } catch {
      throw new BusinessError('تعذرت قراءة الملف. تأكد أنه ملف Excel سليم بصيغة xlsx')
    }
    const ws = wb.worksheets[0]
    if (!ws) throw new BusinessError('الملف لا يحتوي على أوراق')
    grid = []
    numbers = []
    ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
      const values: Cell[] = []
      for (let c = 1; c <= r.cellCount; c++) values.push(cellValue(r.getCell(c).value))
      grid.push(values)
      numbers.push(rowNumber)
    })
  } else if (lower.endsWith('.xls')) {
    throw new BusinessError('صيغة xls القديمة غير مدعومة. افتح الملف في Excel واحفظه بصيغة xlsx ثم ارفعه مجددًا')
  } else {
    throw new BusinessError('الملف يجب أن يكون بصيغة xlsx أو csv')
  }
  const keep = grid.map((r, i) => ({ r, n: numbers[i] })).filter(({ r }) => r.some((c) => cleanText(c as string) !== null))
  if (keep.length < 2) throw new BusinessError('الملف فارغ أو لا يحتوي إلا على صف العناوين')
  const [header, ...rows] = keep
  const headers = header.r.map((h, i) => cleanText(h as string) ?? `عمود ${i + 1}`)
  if (rows.length > MAX_IMPORT_ROWS) throw new BusinessError(`الحد الأقصى ${MAX_IMPORT_ROWS.toLocaleString('en-US')} صف في الملف الواحد`)
  const width = headers.length
  return {
    headers,
    rows: rows.map(({ r }) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? null : r[i]))),
    rowNumbers: rows.map(({ n }) => n),
  }
}
