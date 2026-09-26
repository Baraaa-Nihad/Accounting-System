import { chromium } from 'playwright-core'

// دورة الرواتب كاملة من الواجهة. يتطلب شهرًا بلا مسير معتمد (قاعدة جديدة أو شهر جديد):
// النظام يرفض عن قصد تسجيل إضافي أو احتساب مسير ثانٍ لشهر رواتبه معتمدة.

const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
page.on('dialog', (d) => d.accept())
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const inDialog = (label) => page.getByRole('dialog').locator(`div:has(> label:has-text("${label}"))`).last().locator('input, select, textarea').first()
const onPage = (label) => page.locator(`div:has(> label:has-text("${label}"))`).last().locator('input, select, textarea').first()
const unique = Date.now().toString().slice(-5)

await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', process.env.P || 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)

// 1) موظف جديد
await page.goto(`${base}/employees/new`)
await onPage('الاسم الكامل').fill(`سارة محمود ${unique}`)
await onPage('المسمى الوظيفي').fill('معلمة رياضيات')
await page.getByText('معلم / معلمة').click()
await page.locator('input[inputmode=decimal]').first().fill('3000')
await page.locator('input[inputmode=decimal]').nth(1).fill('20')
await shot('40-employee-form')
await page.getByRole('button', { name: 'حفظ الموظف' }).click()
await page.waitForURL(/\/employees\/\d+$/, { timeout: 20000 })
const employeeUrl = page.url()

// 2) ساعات إضافية
await page.getByRole('button', { name: 'تسجيل ساعات إضافية' }).click()
await inDialog('عدد الساعات').fill('10')
await inDialog('السبب').fill('حصص تقوية')
await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })

// 3) سلفة 600 على 3 أقساط
await page.getByRole('button', { name: 'سلفة جديدة' }).click()
await page.getByRole('dialog').locator('input[inputmode=decimal]').first().fill('600')
await inDialog('عدد الأقساط').fill('3')
await page.getByRole('dialog').getByRole('button', { name: 'صرف السلفة' }).click()
await page.getByRole('dialog').getByText('تم صرف السلفة').waitFor({ timeout: 15000 })
await page.keyboard.press('Escape')
await page.reload()
await shot('41-employee-page')

// 4) احتساب رواتب الشهر
await page.goto(`${base}/payroll`)
await page.getByRole('button', { name: 'احتساب رواتب الشهر' }).click()
await page.getByRole('dialog').getByRole('button', { name: 'احتساب' }).click()
await page.waitForURL(/\/payroll\/\d+$/, { timeout: 30000 })
const runUrl = page.url()
await shot('42-payroll-draft')

// 5) مكافأة 100 وخصم 50 للموظفة
const row = page.locator('tr', { hasText: `سارة محمود ${unique}` })
const inputs = row.locator('input')
// الترتيب: أيام العمل، غياب، تأخير، مكافآت، بدلات، خصومات، استقطاعات
await inputs.nth(3).fill('100')
await inputs.nth(5).fill('50')
await page.locator('h1').click()
await page.waitForTimeout(2500)
const net = await row.locator('td').nth(13).textContent()
console.log('net after edit:', net)
await shot('43-payroll-edited')

// 6) اعتماد
await page.getByRole('button', { name: 'اعتماد المسير' }).click()
await page.getByRole('dialog').getByRole('button', { name: 'اعتماد' }).click()
await page.getByText('معتمد بتاريخ قيد').waitFor({ timeout: 30000 })
await shot('44-payroll-approved')

// 7) صرف الرواتب
await page.getByRole('button', { name: /صرف الرواتب/ }).first().click()
await inDialog('الطريقة').selectOption('CASH')
await inDialog('يُصرف من').selectOption({ label: 'الصندوق الرئيسي' })
await page.getByRole('dialog').getByRole('button', { name: /^صرف/ }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })
await page.waitForTimeout(800)
await shot('45-payroll-paid')

// 8) قسيمة الراتب
const itemLink = await row.locator('a[href^="/print/payslips/"]').getAttribute('href')
await page.goto(`${base}${itemLink}`)
await shot('46-payslip')
await page.goto(runUrl.replace('/payroll/', '/print/payroll/'))
await shot('47-payroll-sheet')
await page.goto(`${employeeUrl}?tab=statement`)
await shot('48-employee-statement')
for (const [path, name] of [['/payroll', '49-payroll-list'], ['/payroll/overtime', '50-overtime'], ['/payroll/advances', '51-advances'], ['/employees', '52-employees']]) {
  await page.goto(`${base}${path}`)
  await shot(name)
}
console.log('errors:', JSON.stringify(errors, null, 1))
await browser.close()
