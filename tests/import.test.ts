import { afterEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { db, transaction } from '@/server/db'
import { BusinessError } from '@/server/errors'
import { getSettings } from '@/server/settings'
import { parseImportFile } from '@/server/import/parse'
import { autoMap } from '@/server/import/mapping'
import { buildTemplate } from '@/server/import/templates'
import { getImportType } from '@/server/import/registry'
import { studentsImport } from '@/server/import/defs/people'
import { commitSession, countStatuses, createImportSession, errorReport, loadSession, saveSessionSettings, sessionOutcome, validateSession } from '@/server/import/service'
import { createCharge } from '@/server/services/charges'
import { parseAmount, parseBool, parseDate, parseDiscount, parseGender, parsePhone } from '@/lib/import-normalize'
import { D } from '@/lib/money'
import { testCtx } from './support/helpers'
import { arBalance, chargeType, currentYear, makeStudent, trialBalanceDiff, yearDate } from './support/fixtures'

const ctx = testCtx()
const uid = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

async function xlsx(headers: string[], rows: unknown[][]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(headers)
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

async function session(type: string, headers: string[], rows: unknown[][]) {
  const batch = await createImportSession(ctx, { type, fileName: `${type}.xlsx`, buffer: await xlsx(headers, rows) })
  return loadSession(ctx, batch.id)
}

describe('value normalization', () => {
  it('cleans amounts, dates, phones, booleans, genders and discounts', () => {
    expect(parseAmount('١٬٥٠٠').value).toBe('1500')
    expect(parseAmount('1,500.00').value).toBe('1500')
    expect(parseAmount('-5').error).toBeDefined()
    expect(parseAmount('-5', { allowNegative: true }).value).toBe('-5')
    expect(parseDate('05/09/2026').value).toBe('2026-09-05')
    expect(parseDate(46270).value).toBe('2026-09-05')
    expect(parseDate('1/1/1900').error).toBeDefined()
    expect(parsePhone('+970 599-123-456', '+970').value).toBe('0599123456')
    expect(parsePhone('00970599123456', '+970').value).toBe('0599123456')
    expect(parsePhone(599123456, '+970').value).toBe('0599123456')
    expect(parseBool('نعم').value).toBe(true)
    expect(parseBool('No').value).toBe(false)
    expect(parseGender('M').value).toBe('MALE')
    expect(parseGender('أنثى').value).toBe('FEMALE')
    expect(parseDiscount('10%').value).toEqual({ method: 'PERCENT', value: '10' })
    expect(parseDiscount('٥٠٠').value).toEqual({ method: 'FIXED', value: '500' })
    expect(parseDiscount('150%').error).toBeDefined()
  })
})

describe('file parsing and column mapping', () => {
  it('reads CSV with BOM, semicolons and quoted fields, keeping original row numbers', async () => {
    const csv = '﻿الاسم;المبلغ;ملاحظات\r\n"علي; محمد";"1,200";"سطر ""مقتبس"""\r\n;;\r\nسارة;300;\r\n'
    const f = await parseImportFile('x.csv', Buffer.from(csv, 'utf8'))
    expect(f.headers).toEqual(['الاسم', 'المبلغ', 'ملاحظات'])
    expect(f.rows[0]).toEqual(['علي; محمد', '1,200', 'سطر "مقتبس"'])
    expect(f.rows[1][0]).toBe('سارة')
    expect(f.rowNumbers).toEqual([2, 4])
  })

  it('reads xlsx values as data only (formula results, dates) and rejects xls', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Data')
    ws.addRow(['الاسم', 'المبلغ', 'التاريخ'])
    ws.addRow(['علي', { formula: 'SUM(1,2)', result: 3 }, new Date(Date.UTC(2026, 8, 5))])
    const f = await parseImportFile('a.xlsx', Buffer.from(await wb.xlsx.writeBuffer()))
    expect(f.rows[0]).toEqual(['علي', 3, '2026-09-05'])
    await expect(parseImportFile('a.xls', Buffer.from('x'))).rejects.toThrow(/xlsx/)
    await expect(parseImportFile('a.xlsx', Buffer.from('not a zip'))).rejects.toThrow(BusinessError)
  })

  it('maps Arabic and English headers automatically', () => {
    const m = autoMap(['Student Name', 'الصف الدراسي', 'اسم الأب', 'رقم الجوال', 'عمود آخر'], studentsImport.fields)
    expect(m.fullName).toBe(0)
    expect(m.grade).toBe(1)
    expect(m.guardianName).toBe(2)
    expect(m.guardianPhone).toBe(3)
    expect(m.section).toBeNull()
  })

  it('builds templates whose headers map back to every field', async () => {
    for (const key of ['students', 'charges', 'installments', 'receipts', 'expenses']) {
      const def = getImportType(key)!
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load((await buildTemplate(def)) as unknown as ArrayBuffer)
      expect(wb.worksheets.map((w) => w.name)).toEqual(['البيانات', 'القوائم', 'التعليمات'])
      const data = wb.worksheets[0]
      // لا يوجد صف مثال في ورقة البيانات حتى لا يُستورد بالخطأ
      expect(data.rowCount).toBe(1)
      const headers = (data.getRow(1).values as unknown[]).slice(1).map(String)
      const mapping = autoMap(headers, def.fields)
      for (const field of def.fields) expect(mapping[field.key], `${key}.${field.key}`).toBe(def.fields.indexOf(field))
    }
  })
})

describe('students import', () => {
  it('validates, links siblings, commits once, and updates on re-import', async () => {
    const u = uid()
    const phone = `056${u.slice(-7)}`
    const headers = ['اسم الطالب', 'الصف', 'الشعبة', 'اسم ولي الأمر', 'هاتف ولي الأمر', 'الجنس', 'العنوان']
    const rows = [
      [`أحمد مستورد ${u}`, 'الصف الخامس', 'أ', `والد ${u}`, phone, 'ذكر', null],
      [`سلمى مستوردة ${u}`, '5', 'ب', `والد ${u}`, phone, 'أنثى', null],
      [`أحمد مستورد ${u}`, 'خامس', 'أ', `والد ${u}`, phone, 'ذكر', null],
      [`خالد ${u}`, 'الصف الخامس عشر', null, `والد ${u}`, `057${u.slice(-7)}`, null, null],
      [`ريم ${u}`, 'الصف الأول', 'أ', null, null, 'X', null],
    ]
    const s = await session('students', headers, rows)
    expect(s.options.yearId).toBe((await currentYear()).id)
    const checked = await validateSession(s)
    expect(countStatuses(checked)).toEqual({ valid: 2, duplicate: 1, error: 2 })
    expect(checked[3].messages.join()).toMatch(/الصف .* غير موجود/)
    expect(checked[4].messages.join()).toMatch(/اسم ولي الأمر/)
    expect(checked[4].messages.join()).toMatch(/الجنس/)

    const res = await commitSession(ctx, s.id)
    expect(res.created).toBe(2)
    const created = await db.student.findMany({ where: { importBatchId: s.id }, include: { enrollments: { include: { grade: true, section: true } } } })
    expect(created).toHaveLength(2)
    expect(new Set(created.map((c) => c.guardianId)).size).toBe(1)
    expect(created.every((c) => c.enrollments[0].grade.name === 'الصف الخامس')).toBe(true)
    expect(created.map((c) => c.enrollments[0].section?.name).sort()).toEqual(['أ', 'ب'])
    const done = await loadSession(ctx, s.id)
    expect(done.status).toBe('COMPLETED')
    expect(done.counts).toMatchObject({ totalRows: 5, importedRows: 2, skippedRows: 1, errorRows: 2 })
    await expect(commitSession(ctx, s.id)).rejects.toThrow('تم تنفيذ هذا الاستيراد مسبقًا')
    // تقرير ما بعد الاستيراد يعتمد على النتيجة المحفوظة (لا يعتبر المستورد مكررًا)
    const outcome = await sessionOutcome(done)
    expect(outcome.filter((r) => r.status === 'imported')).toHaveLength(2)
    expect((await errorReport(ctx, s.id)).subarray(0, 2).toString()).toBe('PK')

    // إعادة الاستيراد: نفس الطلاب مكررون، ومع «تحديث» تُحدّث بياناتهم
    const again = await session('students', headers, rows.slice(0, 2).map((r) => [...r.slice(0, 6), 'حي الزيتون']))
    const second = await validateSession(again)
    expect(second.map((r) => r.status)).toEqual(['duplicate', 'duplicate'])
    await saveSessionSettings(ctx, again.id, { mapping: again.mapping, options: { ...again.options, duplicates: 'update' } })
    const upd = await commitSession(ctx, again.id)
    expect(upd).toMatchObject({ created: 0, updated: 2 })
    const after = await db.student.findMany({ where: { id: { in: created.map((c) => c.id) } } })
    expect(after.every((x) => x.address === 'حي الزيتون')).toBe(true)
  })

  it('creates missing grades and sections only when asked', async () => {
    const u = uid()
    const s = await session('students', ['اسم الطالب', 'الصف', 'الشعبة', 'ولي الأمر', 'الهاتف'], [[`طالب ${u}`, `صف تجريبي ${u}`, 'ج', `ولي ${u}`, `058${u.slice(-7)}`]])
    expect((await validateSession(s))[0].status).toBe('error')
    await saveSessionSettings(ctx, s.id, { mapping: s.mapping, options: { ...s.options, createMissing: true } })
    const s2 = await loadSession(ctx, s.id)
    const v = await validateSession(s2)
    expect(v[0].status).toBe('valid')
    expect(v[0].messages.join()).toMatch(/سيُنشأ صف جديد/)
    const res = await commitSession(ctx, s.id)
    expect(res.created).toBe(1)
    const grade = await db.grade.findFirst({ where: { name: `صف تجريبي ${u}` }, include: { sections: true } })
    expect(grade?.sections.map((x) => x.name)).toEqual(['ج'])
  })

  it('rejects wrong mappings and unknown sessions', async () => {
    const s = await session('students', ['الاسم', 'الصف', 'ولي الأمر', 'الهاتف'], [['س', 'الصف الأول', 'و', '0599000000']])
    await expect(saveSessionSettings(ctx, s.id, { mapping: { ...s.mapping, grade: 0 }, options: s.options })).rejects.toThrow(/مربوط بأكثر من حقل/)
    await expect(saveSessionSettings(ctx, s.id, { mapping: { ...s.mapping, guardianPhone: null }, options: s.options })).rejects.toThrow(/اربط الحقول الإجبارية/)
    await expect(loadSession(ctx, 999999999)).rejects.toThrow(/غير موجودة/)
  })
})

describe('all-or-nothing commit', () => {
  const original = studentsImport.commit
  afterEach(() => {
    studentsImport.commit = original
  })

  it('saves nothing when any row fails, and keeps the session for retry', async () => {
    const u = uid()
    const s = await session('students', ['الاسم', 'الصف', 'ولي الأمر', 'الهاتف'], [
      [`أول ${u}`, 'الصف الأول', `و ${u}`, `059${u.slice(-7)}`],
      [`ثاني ${u}`, 'الصف الأول', `و2 ${u}`, `052${u.slice(-7)}`],
    ])
    studentsImport.commit = async (tx, c, rows, env) => {
      await original(tx, c, rows.slice(0, 1), env)
      throw new BusinessError('الصف 3: فشل مصطنع')
    }
    await expect(commitSession(ctx, s.id)).rejects.toThrow('فشل مصطنع')
    expect(await db.student.count({ where: { importBatchId: s.id } })).toBe(0)
    expect(await db.student.count({ where: { fullName: `أول ${u}` } })).toBe(0)
    const after = await loadSession(ctx, s.id)
    expect(after.status).toBe('PENDING')
    expect((after.result as { lastError?: string }).lastError).toMatch(/فشل مصطنع/)

    studentsImport.commit = original
    const [a, b] = await Promise.allSettled([commitSession(ctx, s.id), commitSession(ctx, s.id)])
    const ok = [a, b].filter((x) => x.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    expect([a, b].find((x) => x.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: 'تم تنفيذ هذا الاستيراد مسبقًا' }) })
    expect(await db.student.count({ where: { importBatchId: s.id } })).toBe(2)
  })
})

describe('financial imports', () => {
  it('imports an installment schedule with prior payments, then receipts that settle the oldest dues', async () => {
    const student = await makeStudent()
    const [d1, d2, d3] = await Promise.all([yearDate(5), yearDate(35), yearDate(65)])
    const s = await session('installments', ['الطالب', 'نوع الذمة', 'رقم القسط', 'تاريخ الاستحقاق', 'المبلغ', 'المدفوع مسبقًا'], [
      [student.studentNumber, 'القسط الدراسي', 1, dmy(d1), 400, 400],
      [student.studentNumber, 'القسط الدراسي', 2, dmy(d2), 400, 100],
      [student.studentNumber, 'القسط الدراسي', 3, dmy(d3), 400, null],
      [student.studentNumber, 'رسوم التسجيل', 1, dmy(d1), 50, 60],
    ])
    const v = await validateSession(s)
    expect(v.map((r) => r.status)).toEqual(['valid', 'valid', 'valid', 'error'])
    expect(v[3].messages.join()).toMatch(/المدفوع أكبر/)
    const res = await commitSession(ctx, s.id)
    expect(res.created).toBe(1)
    const charge = await db.charge.findFirstOrThrow({ where: { importBatchId: s.id }, include: { installments: { orderBy: { number: 'asc' } } } })
    expect(D(charge.grossAmount).toString()).toBe('1200')
    expect(charge.installments.map((i) => [i.dueDate.toISOString().slice(0, 10), D(i.amount).toString(), D(i.paidAmount).toString()])).toEqual([
      [d1, '400', '400'],
      [d2, '400', '100'],
      [d3, '400', '0'],
    ])
    expect((await arBalance(student.id)).toString()).toBe('700')

    // سند قبض مستورد برقمه القديم: يُوزع على أقدم مستحق
    const old = `OLD-${uid()}`
    const r = await session('receipts', ['التاريخ', 'الطالب', 'المبلغ', 'طريقة الدفع', 'رقم السند القديم'], [
      [dmy(d1), student.fullName, 300, 'نقدي', old],
      [dmy(d1), student.studentNumber, 50, 'شيك', `${old}-2`],
      [dmy(d1), 'طالب غير موجود أبدًا', 50, 'نقدي', null],
    ])
    const rv = await validateSession(r)
    expect(rv.map((x) => x.status)).toEqual(['valid', 'error', 'error'])
    await commitSession(ctx, r.id)
    const receipt = await db.receipt.findFirstOrThrow({ where: { importBatchId: r.id } })
    expect(receipt.referenceNumber).toBe(old)
    expect(receipt.number).toMatch(/^REC-/)
    const inst2 = await db.installment.findFirstOrThrow({ where: { chargeId: charge.id, number: 2 } })
    expect(D(inst2.paidAmount).toString()).toBe('400')
    expect((await arBalance(student.id)).toString()).toBe('400')
    // نفس الرقم القديم مرة أخرى = مكرر
    const again = await session('receipts', ['التاريخ', 'الطالب', 'المبلغ', 'رقم السند القديم'], [[dmy(d1), student.studentNumber, 300, old]])
    expect((await validateSession(again))[0].status).toBe('duplicate')
    expect(await trialBalanceDiff()).toBe(0)
  })

  it('imports opening balances (debit and credit) once per student', async () => {
    const [a, b] = [await makeStudent(), await makeStudent()]
    const s = await session('balances', ['رقم الطالب', 'الرصيد'], [
      [a.studentNumber, '1,250'],
      [b.studentNumber, '-300'],
      [a.studentNumber, 10],
    ])
    const v = await validateSession(s)
    expect(v.map((r) => r.status)).toEqual(['valid', 'valid', 'error'])
    await commitSession(ctx, s.id)
    expect((await arBalance(a.id)).toString()).toBe('1250')
    const credit = await db.receipt.findFirstOrThrow({ where: { importBatchId: s.id, studentId: b.id } })
    expect(credit.kind).toBe('OPENING_CREDIT')
    const second = await session('balances', ['رقم الطالب', 'الرصيد'], [[a.studentNumber, 5]])
    expect((await validateSession(second))[0].status).toBe('duplicate')
  })

  it('imports charges with discount and equal installments', async () => {
    const st = await makeStudent()
    const d = await yearDate(10)
    const s = await session('charges', ['الطالب', 'نوع الذمة', 'المبلغ', 'الخصم', 'عدد الأقساط', 'تاريخ أول قسط'], [
      [st.studentNumber, 'القسط الدراسي', 3000, '10%', 3, dmy(d)],
      [st.studentNumber, 'رسوم التسجيل', 200, null, 2, null],
      [st.studentNumber, 'نوع غير موجود', 100, null, null, null],
    ])
    const v = await validateSession(s)
    expect(v.map((r) => r.status)).toEqual(['valid', 'error', 'error'])
    expect(v[1].messages.join()).toMatch(/لا يقبل التقسيط/)
    await commitSession(ctx, s.id)
    const c = await db.charge.findFirstOrThrow({ where: { importBatchId: s.id }, include: { installments: true } })
    expect(D(c.netAmount).toString()).toBe('2700')
    expect(c.installments).toHaveLength(3)
    // ذمة مطابقة في نفس السنة = مكررة
    const dup = await session('charges', ['الطالب', 'نوع الذمة', 'المبلغ'], [[st.studentNumber, 'القسط الدراسي', 3000]])
    expect((await validateSession(dup))[0].status).toBe('duplicate')
  })

  it('imports expenses as vouchers and blocks rows beyond the cash balance', async () => {
    const settings = await getSettings()
    const box = await db.cashAccount.findFirstOrThrow({ where: { isDefault: true } })
    // تمويل الصندوق بذمة وسند قبض حتى يكفي الرصيد
    const st = await makeStudent()
    const d = await yearDate(6)
    const type = await chargeType()
    const year = await currentYear()
    await transaction((tx) => createCharge(tx, ctx, { studentId: st.id, chargeTypeId: type.id, academicYearId: year.id, date: d, grossAmount: '500' }))
    const fund = await session('receipts', ['التاريخ', 'الطالب', 'المبلغ'], [[dmy(d), st.studentNumber, 500]])
    await commitSession(ctx, fund.id)

    const s = await session('expenses', ['التاريخ', 'التصنيف', 'المبلغ', 'المستفيد', 'الصندوق'], [
      [dmy(d), 'الكهرباء', 120, 'شركة الكهرباء', box.name],
      [dmy(d), 'تصنيف غير موجود', 10, null, null],
      [dmy(d), 'القرطاسية', 999999999, null, null],
      ['01/01/2099', 'القرطاسية', 5, null, null],
    ])
    const v = await validateSession(s)
    expect(v[0].status).toBe('valid')
    expect(v[1].messages.join()).toMatch(/غير موجود/)
    if (!settings.finance.allowNegativeCash) expect(v[2].messages.join()).toMatch(/رصيد الصندوق لا يكفي/)
    expect(v[3].status).toBe('error')
    await commitSession(ctx, s.id)
    const vouchers = await db.paymentVoucher.findMany({ where: { importBatchId: s.id } })
    expect(vouchers).toHaveLength(1)
    expect(vouchers[0]).toMatchObject({ kind: 'EXPENSE', payeeName: 'شركة الكهرباء' })
    expect(D(vouchers[0].amount).toString()).toBe('120')
    expect(await trialBalanceDiff()).toBe(0)
  })
})
