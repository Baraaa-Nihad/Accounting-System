import { chromium } from 'playwright-core'

/** فحص شاشات الإدارة: المستخدمون، تخصيص الصلاحيات، الأدوار، الشركاء، حسابي، ومنع الوصول. */
const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const u = Date.now().toString(36).slice(-5)
const username = `clerk.${u}`

async function login(user, pass) {
  await page.goto(`${base}/login`)
  await page.fill('#username', user)
  await page.fill('#password', pass)
  await page.click('button[type=submit]')
}

await login('admin', process.env.P || 'Admin@2026x')
await page.waitForURL(`${base}/`)
await page.goto(`${base}/users`)
await shot('70-users')

// مستخدم جديد بدور موظف مالي
await page.getByRole('button', { name: 'إضافة مستخدم' }).click()
const dlg = page.getByRole('dialog')
await dlg.locator('div:has(> label:has-text("الاسم الكامل"))').last().locator('input').fill(`موظفة الصندوق ${u}`)
await dlg.locator('div:has(> label:has-text("اسم المستخدم"))').last().locator('input').fill(username)
const tempPassword = await dlg.locator('div:has(> label:has-text("كلمة المرور المؤقتة"))').last().locator('input').inputValue()
await dlg.locator('select').selectOption({ label: 'موظف مالي' })
await dlg.getByRole('button', { name: 'إضافة' }).click()
await page.waitForURL(/\/users\/\d+$/, { timeout: 20000 })

// إضافة صلاحية التصدير وحجب إنشاء سند الصرف
await page.getByLabel('تصدير التقارير (Excel، PDF، CSV)').check()
await page.getByLabel('إنشاء سند صرف').uncheck()
await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
await page.getByText('تم حفظ بيانات المستخدم وصلاحياته').waitFor()
await page.reload()
if (!(await page.getByLabel('تصدير التقارير (Excel، PDF، CSV)').isChecked())) errors.push('extra permission not saved')
await shot('71-user-page')

await page.goto(`${base}/users/roles`)
await shot('72-roles')

// شريك جديد
await page.goto(`${base}/partners`)
await page.getByRole('button', { name: 'إضافة شريك' }).click()
const pd = page.getByRole('dialog')
await pd.locator('div:has(> label:has-text("اسم الشريك"))').last().locator('input').fill(`شريك تجريبي ${u}`)
await pd.locator('div:has(> label:has-text("نسبة الملكية"))').last().locator('input').fill('0')
await pd.getByRole('button', { name: 'حفظ' }).click()
await page.waitForURL(/\/partners\/\d+$/, { timeout: 20000 })
await shot('73-partner')
await page.goto(`${base}/partners`)
await shot('74-partners')

await page.goto(`${base}/profile`)
await shot('75-profile')

// دخول المستخدم الجديد: تغيير كلمة المرور إلزامي، ثم منع الوصول لصفحة المستخدمين
await context.clearCookies()
await login(username, tempPassword)
await page.waitForURL(`${base}/change-password`, { timeout: 20000 })
await page.locator('input[autocomplete=current-password]').fill(tempPassword)
await page.locator('input[autocomplete=new-password]').first().fill(`New-${u}-2026`)
await page.locator('input[autocomplete=new-password]').nth(1).fill(`New-${u}-2026`)
await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click()
await page.waitForURL(`${base}/`, { timeout: 20000 })
await page.goto(`${base}/users`)
await page.waitForURL(`${base}/forbidden`)
await shot('76-forbidden')

console.log(JSON.stringify({ username, errors }))
await browser.close()
