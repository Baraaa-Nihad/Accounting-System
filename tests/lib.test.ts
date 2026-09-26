import { describe, expect, it } from 'vitest'
import { D, splitEven, percentOf, distributeProportional, parseAmountInput, sum } from '@/lib/money'
import { amountToArabicWords, numberToWords } from '@/lib/tafqeet'
import { addMonths, parseFlexibleDate, startOfWeek, endOfMonth, diffDays } from '@/lib/dates'
import { normalizeArabic, buildSearchText, cleanPhone, phonesMatch } from '@/lib/arabic'
import { effectivePermissions } from '@/lib/permissions'

describe('money', () => {
  it('splits evenly with remainder on the last part', () => {
    expect(splitEven(4800, 8, 2).map((d) => d.toFixed(2))).toEqual(Array(8).fill('600.00'))
    expect(splitEven(1000, 3, 2).map((d) => d.toFixed(2))).toEqual(['333.33', '333.33', '333.34'])
    expect(sum(splitEven('1000.005', 7, 3)).toFixed(3)).toBe('1000.005')
  })
  it('computes percent discounts exactly', () => {
    expect(percentOf(5000, 10, 2).toFixed(2)).toBe('500.00')
    expect(percentOf('333.33', '12.5', 2).toFixed(2)).toBe('41.67')
  })
  it('distributes proportionally without exceeding weights', () => {
    const parts = distributeProportional(100, [300, 200, 500], 2)
    expect(parts.map((p) => p.toFixed(2))).toEqual(['30.00', '20.00', '50.00'])
    const odd = distributeProportional('0.05', [1, 1, 1], 2)
    expect(sum(odd).toFixed(2)).toBe('0.05')
    for (const p of odd) expect(p.lessThanOrEqualTo(1)).toBe(true)
    const full = distributeProportional('10.01', ['3.33', '3.34', '3.34'], 2)
    expect(full.map((p) => p.toFixed(2))).toEqual(['3.33', '3.34', '3.34'])
  })
  it('parses user input with Arabic digits and separators', () => {
    expect(parseAmountInput('١٥٠٠')?.toString()).toBe('1500')
    expect(parseAmountInput('1,500.50')?.toString()).toBe('1500.5')
    expect(parseAmountInput('abc')).toBeNull()
    expect(parseAmountInput('')).toBeNull()
  })
  it('never uses floating point', () => {
    expect(D('0.1').plus(D('0.2')).toString()).toBe('0.3')
  })
})

describe('tafqeet', () => {
  it('writes numbers in Arabic words', () => {
    expect(numberToWords(0)).toBe('صفر')
    expect(numberToWords(21)).toBe('واحد وعشرون')
    expect(numberToWords(1500)).toBe('ألف وخمسمائة')
    expect(numberToWords(2000)).toBe('ألفان')
    expect(numberToWords(3000)).toBe('ثلاثة آلاف')
    expect(numberToWords(11000)).toBe('أحد عشر ألفًا')
    expect(numberToWords(100000)).toBe('مائة ألف')
    expect(numberToWords(1_250_000)).toBe('مليون ومائتان وخمسون ألفًا')
  })
  it('writes currency amounts', () => {
    expect(amountToArabicWords(1520.5, 'ILS')).toBe('فقط ألف وخمسمائة وعشرون شيكلًا وخمسون أغورة لا غير')
    expect(amountToArabicWords(1, 'JOD')).toBe('فقط دينار واحد لا غير')
    expect(amountToArabicWords(2, 'JOD')).toBe('فقط ديناران لا غير')
    expect(amountToArabicWords(5, 'JOD')).toBe('فقط خمسة دنانير لا غير')
    expect(amountToArabicWords(4500, 'SAR')).toBe('فقط أربعة آلاف وخمسمائة ريال لا غير')
    expect(amountToArabicWords(0.25, 'JOD')).toBe('فقط مائتان وخمسون فلسًا لا غير')
  })
})

describe('dates', () => {
  it('keeps the due day and clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2027-12-15', 2, 31)).toBe('2028-02-29')
    expect(addMonths('2026-09-05', 7, 5)).toBe('2027-04-05')
  })
  it('parses flexible date formats', () => {
    expect(parseFlexibleDate('05/09/2026')).toBe('2026-09-05')
    expect(parseFlexibleDate('2026-9-5')).toBe('2026-09-05')
    expect(parseFlexibleDate('٠٥/٠٩/٢٠٢٦')).toBe('2026-09-05')
    expect(parseFlexibleDate(46270)).toBe('2026-09-05')
    expect(parseFlexibleDate('31/02/2026')).toBeNull()
  })
  it('computes weeks and months', () => {
    expect(startOfWeek('2026-09-26', 6)).toBe('2026-09-26') // السبت
    expect(startOfWeek('2026-09-30', 6)).toBe('2026-09-26')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(diffDays('2026-10-01', '2026-09-26')).toBe(5)
  })
})

describe('arabic search', () => {
  it('normalizes letters and digits', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'))
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'))
    expect(normalizeArabic('مُصْطَفَى')).toBe('مصطفي')
    expect(normalizeArabic('٠٥٩٩')).toBe('0599')
  })
  it('builds search text including phone digits', () => {
    const t = buildSearchText(['محمد أحمد', '0599-123-456'])
    expect(t).toContain('0599123456')
  })
  it('cleans and matches phones', () => {
    expect(cleanPhone('+970 599-123-456')).toBe('+970599123456')
    expect(phonesMatch('+970599123456', '0599123456')).toBe(true)
    expect(phonesMatch('0599123456', '0599123457')).toBe(false)
  })
})

describe('permissions', () => {
  it('combines role, extra and revoked permissions', () => {
    const p = effectivePermissions({
      roleKey: 'clerk',
      rolePermissions: ['students.view', 'receipts.create'],
      extraPermissions: ['reports.export'],
      revokedPermissions: ['receipts.create'],
    })
    expect(p.has('students.view')).toBe(true)
    expect(p.has('reports.export')).toBe(true)
    expect(p.has('receipts.create')).toBe(false)
  })
  it('gives admin everything', () => {
    const p = effectivePermissions({ roleKey: 'admin', rolePermissions: [], extraPermissions: [], revokedPermissions: [] })
    expect(p.has('backup.manage')).toBe(true)
  })
})
