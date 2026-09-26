import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const inDialog = (label) => page.getByRole('dialog').locator(`div:has(> label:has-text("${label}"))`).last().locator('input, select, textarea').first()
const onPage = (label) => page.locator(`div:has(> label:has-text("${label}"))`).last().locator('input, select, textarea').first()
const unique = Date.now().toString().slice(-5)

await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', process.env.P || 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)

// 0) تمويل الصندوق بإيراد آخر (تبرع)
await page.goto(`${base}/receipts/new?mode=revenue`)
await onPage('تصنيف الإيراد').selectOption({ label: 'التبرعات' })
await onPage('اسم الدافع / المتبرع').fill('متبرع كريم')
await page.locator('input[inputmode=decimal]').first().fill('5000')
await page.getByRole('button', { name: 'حفظ السند' }).click()
await page.getByText('تم حفظ سند القبض', { exact: true }).waitFor({ timeout: 20000 })

// 1) الصندوق والبنوك: إضافة حساب بنكي
await page.goto(`${base}/treasury`)
await shot('20-treasury')
await page.getByRole('button', { name: 'صندوق / حساب بنكي' }).click()
await page.getByRole('dialog').getByRole('button', { name: 'حساب بنكي' }).click()
await inDialog('الاسم').fill(`بنك الاختبار ${unique}`)
await inDialog('اسم البنك').fill('بنك فلسطين')
await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })

// 2) تحويل 300 من الصندوق الرئيسي إلى البنك
await page.getByRole('button', { name: 'تحويل مبلغ' }).click()
await inDialog('إلى').selectOption({ label: `بنك الاختبار ${unique}` })
await page.getByRole('dialog').locator('input[inputmode=decimal]').first().fill('300')
await inDialog('البيان').fill('إيداع نقدية')
await page.getByRole('dialog').getByRole('button', { name: 'تنفيذ التحويل' }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })
await page.waitForTimeout(800)
await shot('21-treasury-after-transfer')

// 3) سند صرف مصروف
await page.goto(`${base}/vouchers/new`)
await onPage('نوع المصروف').selectOption({ label: 'الكهرباء' })
await onPage('اسم المستفيد').fill('شركة الكهرباء')
await page.locator('input[inputmode=decimal]').first().fill('120')
await onPage('البيان').fill('فاتورة كهرباء شهر 9')
await shot('22-voucher-form')
await page.getByRole('button', { name: 'حفظ سند الصرف' }).click()
await page.getByText('تم حفظ سند الصرف', { exact: true }).waitFor({ timeout: 20000 })
const vnum = await page.locator('p.num').first().textContent()
console.log('voucher:', vnum)
await page.getByRole('link', { name: 'عرض السند' }).click()
await page.waitForURL(/\/vouchers\/\d+$/)
const voucherUrl = page.url()
await shot('23-voucher-page')
await page.goto(voucherUrl.replace('/vouchers/', '/print/vouchers/'))
await shot('24-voucher-print')

// 4) مورد + فاتورة + دفعة
await page.goto(`${base}/suppliers`)
await page.getByRole('button', { name: 'إضافة مورد' }).click()
await inDialog('اسم المورد').fill(`مكتبة النور ${unique}`)
await inDialog('التصنيف').fill('قرطاسية')
await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
await page.waitForURL(/\/suppliers\/\d+$/, { timeout: 15000 })
const supplierUrl = page.url()
await page.getByRole('button', { name: 'فاتورة جديدة' }).click()
await inDialog('نوع المصروف').selectOption({ label: 'القرطاسية' })
await page.getByRole('dialog').locator('input[inputmode=decimal]').first().fill('800')
await inDialog('رقم فاتورة المورد').fill('INV-77')
await page.getByRole('dialog').getByRole('button', { name: 'حفظ الفاتورة' }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })
await page.getByRole('link', { name: 'دفعة للمورد' }).click()
await page.waitForURL(/\/vouchers\/new/)
await page.locator('input[inputmode=decimal]').first().fill('300')
await page.getByRole('button', { name: 'حفظ سند الصرف' }).click()
await page.getByText('تم حفظ سند الصرف', { exact: true }).waitFor({ timeout: 20000 })
await page.goto(`${supplierUrl}?tab=statement`)
await shot('25-supplier-statement')

// 5) عامل/مقاول + عمل + دفعة
await page.goto(`${base}/contractors`)
await page.getByRole('button', { name: 'إضافة عامل / مقاول' }).click()
await inDialog('الاسم').fill(`أبو خالد الدهان ${unique}`)
await inDialog('التخصص').fill('دهان')
await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
await page.waitForURL(/\/contractors\/\d+$/, { timeout: 15000 })
await page.getByRole('button', { name: 'عمل / اتفاق جديد' }).click()
await inDialog('وصف العمل').fill('دهان 5 صفوف')
await page.getByRole('dialog').locator('input[inputmode=decimal]').first().fill('1500')
await inDialog('نوع المصروف').selectOption({ label: 'الصيانة' })
await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })
await page.getByRole('button', { name: 'إجراءات' }).first().click()
await page.getByRole('menuitem', { name: 'صرف دفعة' }).click()
await page.waitForURL(/\/vouchers\/new/)
await page.locator('input[inputmode=decimal]').first().fill('200')
await page.getByRole('button', { name: 'حفظ سند الصرف' }).click()
await page.getByText('تم حفظ سند الصرف', { exact: true }).waitFor({ timeout: 20000 })
await page.goBack()
await page.waitForTimeout(500)
await page.goto(page.url().split('?')[0].replace(/\/vouchers\/new.*/, ''))

// 6) الصفحات العامة
for (const [path, name] of [
  ['/vouchers', '26-vouchers'],
  ['/expenses', '27-expenses'],
  ['/revenues', '28-revenues'],
  ['/treasury/transfers', '29-transfers'],
  ['/suppliers', '30-suppliers'],
  ['/contractors', '31-contractors'],
]) {
  await page.goto(`${base}${path}`)
  await page.waitForLoadState('networkidle')
  await shot(name)
}
const treasury = await page.goto(`${base}/treasury`)
console.log('treasury status', treasury?.status())
await shot('32-treasury-final')
console.log('errors:', JSON.stringify(errors, null, 1))
await browser.close()
