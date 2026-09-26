import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
const field = (label) => page.locator(`div:has(> label:has-text("${label}"))`).last().locator('input, select, textarea').first()
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: false })

await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', process.env.P || 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)

// 1) إضافة طالب
await page.goto(`${base}/students/new`)
const unique = Date.now().toString().slice(-5)
await field('اسم الطالب الكامل').fill(`محمد أحمد علي ${unique}`)
await field('اسم ولي الأمر').fill(`أحمد علي ${unique}`)
await field('رقم الهاتف').fill(`0599${unique}1`)
await field('الصف').selectOption({ label: 'الصف الخامس' })
await shot('10-new-student')
await page.getByRole('button', { name: 'حفظ الطالب' }).click()
await page.waitForURL(/\/students\/\d+$/, { timeout: 20000 })
const studentUrl = page.url()
console.log('student page:', studentUrl)
await shot('11-student-page')

// 2) إضافة ذمة مع خصم وتقسيط
await page.getByRole('button', { name: 'إضافة ذمة' }).click()
const dlg = page.getByRole('dialog')
await dlg.locator('div:has(> label:has-text("نوع الذمة")) select').selectOption({ label: 'القسط الدراسي' })
await dlg.locator('div:has(> label:has-text("قيمة الذمة")) input').fill('5000')
await dlg.getByText('يوجد خصم على هذه الذمة').click()
await dlg.locator('div:has(> label:has-text("نسبة الخصم")) input').fill('10')
await dlg.locator('div:has(> label:text-is("سبب الخصم*")) input, div:has(> label:has-text("سبب الخصم")):not(:has(input[type=checkbox])) > input').first().fill('خصم إخوة')
await dlg.getByPlaceholder('اسم الشخص').fill('المدير')
const inst = dlg.getByText('تقسيط المبلغ')
if (!(await dlg.locator('div:has(> label:has-text("عدد الأقساط")) input').count())) await inst.click()
await dlg.locator('div:has(> label:has-text("عدد الأقساط")) input').fill('9')
await shot('12-charge-dialog')
await dlg.getByRole('button', { name: 'حفظ الذمة' }).click()
await page.waitForTimeout(2500)
await shot('13-after-charge')

// 3) تسجيل دفعة
await page.getByRole('button', { name: 'تسجيل دفعة' }).click()
const pay = page.getByRole('dialog')
await pay.locator('input[inputmode=decimal]').first().fill('1000')
await page.waitForTimeout(300)
await shot('14-payment-dialog')
await pay.getByRole('button', { name: 'حفظ الدفعة وإنشاء السند' }).click()
await pay.getByText('تم حفظ سند القبض').waitFor({ timeout: 20000 })
const number = await pay.locator('p.num').first().textContent()
console.log('receipt:', number)
await shot('15-payment-done')
const printHref = await pay.getByRole('link', { name: 'طباعة السند' }).getAttribute('href')
await page.keyboard.press('Escape')

// 4) التبويبات
for (const tab of ['charges', 'installments', 'statement']) {
  await page.goto(`${studentUrl}?tab=${tab}`)
  await page.waitForLoadState('networkidle')
  await shot(`16-tab-${tab}`)
}
// 5) طباعة السند
await page.goto(`${base}${printHref.replace('?auto=1', '')}`)
await page.waitForLoadState('networkidle')
await shot('17-print-receipt')

console.log('errors:', errors.length ? errors : 'none')
await browser.close()
