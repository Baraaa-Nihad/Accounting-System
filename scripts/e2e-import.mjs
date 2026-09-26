import { chromium } from 'playwright-core'
import ExcelJS from 'exceljs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** فحص معالج الاستيراد من المتصفح: القالب، الرفع، الربط، المعاينة، التأكيد، النتيجة. */
const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('caret-color')) errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const u = Date.now().toString().slice(-6)

await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', process.env.P || 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)

await page.goto(`${base}/import`)
await shot('60-import-index')

// القالب الجاهز
const tpl = await page.request.get(`${base}/api/import/template/students`)
if (tpl.status() !== 200 || (await tpl.body()).subarray(0, 2).toString() !== 'PK') errors.push(`template ${tpl.status()}`)

// ملف طلاب بعناوين مختلطة (عربي/إنجليزي) وصف خاطئ
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Students')
ws.addRow(['Student Name', 'الصف الدراسي', 'Section', 'اسم الأب', 'Mobile', 'Gender', 'مكان السكن', 'عمود زائد'])
ws.addRow([`يوسف كريم ${u}`, 'الصف الثالث', 'أ', `كريم يوسف ${u}`, `+970 59${u.slice(-7)}`, 'M', 'غزة', 'x'])
ws.addRow([`ليان كريم ${u}`, '3', 'ب', `كريم يوسف ${u}`, `059${u.slice(-7)}`, 'F', 'غزة', 'x'])
ws.addRow([`مازن ${u}`, 'الصف العشرون', null, `والد ${u}`, `056${u.slice(-7)}`, null, null, null])
const file = path.join(os.tmpdir(), `students-${u}.xlsx`)
await writeFile(file, Buffer.from(await wb.xlsx.writeBuffer()))
await page.locator('input[aria-label="ملف الطلاب"]').setInputFiles(file)
await page.waitForURL(/\/import\/\d+$/, { timeout: 20000 })
await page.getByText('نتيجة التحقق لـ').waitFor()
await shot('61-import-mapping')

// ربط العمود الزائد بحقل الملاحظات ثم التطبيق
await page.getByLabel('عمود ملاحظات').selectOption({ label: 'H: عمود زائد' })
await page.getByRole('button', { name: 'تطبيق التغييرات وإعادة التحقق' }).click()
await page.getByRole('button', { name: 'تطبيق التغييرات وإعادة التحقق' }).waitFor({ state: 'detached', timeout: 20000 })
await page.getByRole('link', { name: /خطأ/ }).first().click()
await page.waitForURL(/status=error/)
await shot('62-import-errors')

// التأكيد
await page.getByRole('button', { name: /تأكيد الاستيراد/ }).click()
await page.getByRole('dialog').getByRole('button', { name: 'استيراد الآن' }).click()
await page.getByText('تم الاستيراد بنجاح').waitFor({ timeout: 30000 })
await shot('63-import-done')
const report = await page.request.get(`${page.url().replace(/\?.*$/, '')}`.replace('/import/', '/api/import/') + '/errors?all=1')
if (report.status() !== 200) errors.push(`report ${report.status()}`)

// النتيجة في قائمة الطلاب
await page.goto(`${base}/students?q=${encodeURIComponent(`كريم ${u}`)}`)
const found = await page.getByText(`يوسف كريم ${u}`).count()
if (!found) errors.push('imported student not listed')
await page.goto(`${base}/import`)
await shot('64-import-history')

console.log('errors', JSON.stringify(errors))
await browser.close()
