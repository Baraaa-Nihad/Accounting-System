import { chromium } from 'playwright-core'

/** فحص إدارة السنوات: إنشاء سنة جديدة، ترحيل الطلاب، إغلاق سنة وإعادة فتحها. */
const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })

await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', process.env.P || 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)

// سنة جديدة (الاقتراح التلقائي)
await page.goto(`${base}/settings/years`)
const nextName = await page.evaluate(() => document.body.innerText.includes('2027/2028'))
if (!nextName) {
  await page.getByRole('button', { name: 'سنة دراسية جديدة' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'إنشاء' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 })
}
await page.reload()
await shot('110-years')

// الترحيل
await page.goto(`${base}/students/promote`)
await page.getByRole('heading', { name: 'ربط الصفوف' }).waitFor()
const firstAction = page.locator('select[aria-label^="إجراء "]').first()
if (await firstAction.count()) await firstAction.selectOption('repeat')
await shot('111-promote-form')
await page.getByRole('button', { name: 'تنفيذ الترحيل' }).click()
await page.getByRole('dialog').getByRole('button', { name: 'تنفيذ' }).click()
await page.getByText(/تم الترحيل/).waitFor({ timeout: 30000 })
await page.reload()
await shot('112-promote-done')

// إغلاق سنة قديمة (فارغة) ثم إعادة فتحها
await page.goto(`${base}/settings/years/1`)
if (await page.getByRole('button', { name: /إغلاق السنة/ }).count()) {
  const name = (await page.locator('h1').innerText()).replace('السنة الدراسية', '').trim()
  await page.getByRole('button', { name: /إغلاق السنة/ }).first().click()
  await page.getByRole('dialog').locator('input').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق السنة' }).click()
  await page.getByText('تم إغلاق السنة').waitFor({ timeout: 30000 })
  await page.reload()
  await shot('113-year-closed')
  await page.getByRole('button', { name: 'إعادة فتح السنة' }).click()
  await page.getByRole('dialog').locator('textarea').fill('اختبار إعادة الفتح')
  await page.getByRole('dialog').getByRole('button', { name: 'إعادة الفتح' }).click()
  await page.getByText(/تمت إعادة فتح السنة/).waitFor({ timeout: 30000 })
}
console.log(JSON.stringify({ errors }))
await browser.close()
