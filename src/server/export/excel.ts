import 'server-only'
import ExcelJS from 'exceljs'

/**
 * تصدير الجداول إلى Excel (ورقة من اليمين لليسار، ترويسة منسقة، أعمدة مبالغ بتنسيق رقمي، صف إجماليات)
 * وإلى CSV (UTF-8 مع BOM ليفتحه Excel بالعربية بشكل صحيح).
 */

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent'

export interface ExportColumn {
  key: string
  header: string
  type?: ColumnType
  width?: number
}

export interface ExportTable {
  title: string
  schoolName: string
  meta?: string[]
  columns: ExportColumn[]
  rows: Record<string, string | number | null | undefined>[]
  totals?: Record<string, string | number | null | undefined>
  decimals: number
  sheetName?: string
}

function cellValue(v: string | number | null | undefined, type: ColumnType | undefined) {
  if (v === null || v === undefined || v === '') return null
  if (type === 'money' || type === 'number' || type === 'percent') {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : String(v)
  }
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00Z`)
  }
  return String(v)
}

export async function buildWorkbook(tables: ExportTable | ExportTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'School Accounting'
  wb.created = new Date()
  const list = Array.isArray(tables) ? tables : [tables]
  for (const t of list) {
    const ws = wb.addWorksheet((t.sheetName ?? t.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 5 + (t.meta?.length ? 1 : 0) }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    })
    const n = t.columns.length
    const moneyFmt = t.decimals > 0 ? `#,##0.${'0'.repeat(t.decimals)}` : '#,##0'
    ws.mergeCells(1, 1, 1, n)
    ws.getCell(1, 1).value = t.schoolName
    ws.getCell(1, 1).font = { bold: true, size: 14 }
    ws.mergeCells(2, 1, 2, n)
    ws.getCell(2, 1).value = t.title
    ws.getCell(2, 1).font = { bold: true, size: 13, color: { argb: 'FF0E7D73' } }
    let r = 3
    if (t.meta?.length) {
      ws.mergeCells(r, 1, r, n)
      ws.getCell(r, 1).value = t.meta.join('   |   ')
      ws.getCell(r, 1).font = { size: 10, color: { argb: 'FF475569' } }
      r++
    }
    r++
    const header = ws.getRow(r)
    t.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1)
      cell.value = c.header
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7D73' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })
    header.height = 22
    for (const row of t.rows) {
      r++
      const xr = ws.getRow(r)
      t.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1)
        cell.value = cellValue(row[c.key], c.type)
        if (c.type === 'money') cell.numFmt = moneyFmt
        if (c.type === 'number') cell.numFmt = '#,##0.##'
        if (c.type === 'percent') cell.numFmt = '0.00"%"'
        if (c.type === 'date') cell.numFmt = 'dd/mm/yyyy'
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } }
      })
    }
    if (t.totals) {
      r++
      const tr = ws.getRow(r)
      t.columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1)
        cell.value = cellValue(t.totals![c.key], c.type)
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
        if (c.type === 'money') cell.numFmt = moneyFmt
        cell.border = { top: { style: 'medium' } }
      })
    }
    t.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width ?? (c.type === 'money' ? 16 : c.type === 'date' ? 13 : 22)
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

export function buildCsv(t: Pick<ExportTable, 'columns' | 'rows' | 'totals'>): Buffer {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [t.columns.map((c) => esc(c.header)).join(',')]
  for (const row of t.rows) lines.push(t.columns.map((c) => esc(row[c.key])).join(','))
  if (t.totals) lines.push(t.columns.map((c) => esc(t.totals![c.key])).join(','))
  return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(lines.join('\r\n'), 'utf8')])
}

export function fileResponseHeaders(fileName: string, type: 'xlsx' | 'csv' | 'pdf') {
  const mime =
    type === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : type === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/pdf'
  return {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="export.${type}"; filename*=UTF-8''${encodeURIComponent(fileName)}.${type}`,
    'Cache-Control': 'no-store',
  }
}
