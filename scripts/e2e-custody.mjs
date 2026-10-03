import { chromium } from 'playwright-core'

/**
 * عهدة الصناديق من الواجهة: المدير يضيف موظفًا ويسلّمه صندوقًا ويضيف صندوقًا لشريك،
 * ثم يدخل الموظف فيرى «صندوقي» ولا يستخدم في السندات إلا صندوقه والبنوك.
 */
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
const username = `cashier.${u}`
const fullName = `أمينة الصندوق ${u}`

async function login(user, pass) {
  await page.goto(`${base}/login`)
  await page.fill('#username', user)
  await page.fill('#password', pass)
  await page.click('button[type=submit]')
}

await login('admin', process.env.P || 'Admin@2026x')
await page.waitForURL(`${base}/`)

// موظف جديد بدور «موظف مالي»
await page.goto(`${base}/users`)
await page.getByRole('button', { name: 'إضافة مستخدم' }).click()
let dlg = page.getByRole('dialog')
await dlg.locator('div:has(> label:has-text("الاسم الكامل"))').last().locator('input').fill(fullName)
await dlg.locator('div:has(> label:has-text("اسم المستخدم"))').last().locator('input').fill(username)
const tempPassword = await dlg.locator('div:has(> label:has-text("كلمة المرور المؤقتة"))').last().locator('input').inputValue()
await dlg.locator('select').selectOption({ label: 'موظف مالي' })
await dlg.getByRole('button', { name: 'إضافة' }).click()
await page.waitForURL(/\/users\/\d+$/, { timeout: 20000 })

// صندوق في عهدة الموظف
async function addBox(name, custodyLabel) {
  await page.goto(`${base}/treasury`)
  await page.getByRole('button', { name: 'صندوق / حساب بنكي' }).click()
  dlg = page.getByRole('dialog')
  await dlg.locator('div:has(> label:has-text("الاسم"))').first().locator('input').fill(name)
  const select = dlg.locator('div:has(> label:has-text("في عهدة"))').last().locator('select')
  const value = await select.locator('option', { hasText: custodyLabel }).first().getAttribute('value')
  await select.selectOption(value)
  await dlg.getByRole('button', { name: 'حفظ' }).click()
  await page.getByText(`تمت إضافة «${name}»`).waitFor()
  return value
}
const myBox = `صندوق ${fullName}`
await addBox(myBox, username)
await page.reload()
await page.getByText(`في عهدة ${fullName}`).waitFor()
await page.getByText('النقدية لدى أصحاب العهدة').waitFor()
await shot('80-treasury-custody')

// صندوق لشريك (أول شريك فعال في القائمة)
await page.getByRole('button', { name: 'صندوق / حساب بنكي' }).click()
dlg = page.getByRole('dialog')
const partnerOption = dlg.locator('optgroup[label="الشركاء"] option').first()
const partnerName = (await partnerOption.textContent())?.trim()
await page.keyboard.press('Escape')
if (!partnerName) throw new Error('no active partner in the dev database')
const partnerValue = await addBox(`صندوق الشريك ${partnerName} ${u}`, partnerName)
await page.goto(`${base}/partners/${partnerValue.split(':')[1]}`)
await page.getByRole('heading', { name: 'صندوق الشريك' }).waitFor()
await shot('81-partner-box')

// دخول الموظف: تغيير كلمة المرور ثم «صندوقي»
await context.clearCookies()
await login(username, tempPassword)
await page.waitForURL(`${base}/change-password`, { timeout: 20000 })
await page.locator('input[autocomplete=current-password]').fill(tempPassword)
await page.locator('input[autocomplete=new-password]').first().fill(`New-${u}-2026`)
await page.locator('input[autocomplete=new-password]').nth(1).fill(`New-${u}-2026`)
await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click()
await page.waitForURL(`${base}/`, { timeout: 20000 })
await page.getByText('صندوقي').waitFor()
// التنبيهات لا تكشف صناديق غيره
if (await page.getByText(/صندوق الشريك/).count()) errors.push('alerts mention a box outside the employee custody')
await shot('82-dashboard-my-box')

// سند قبض: صندوقه مختار، ولا صناديق نقدية لغيره
await page.goto(`${base}/receipts/new?mode=revenue`)
const boxSelect = page.locator('div:has(> label:has-text("الصندوق/الحساب المستلم"))').last().locator('select')
await boxSelect.waitFor()
const selected = await boxSelect.evaluate((s) => s.options[s.selectedIndex]?.textContent ?? '')
const labels = await boxSelect.locator('option').allTextContents()
if (!selected.includes(myBox)) errors.push(`expected own box selected, got: ${selected}`)
if (labels.some((l) => l.includes('الصندوق الرئيسي'))) errors.push(`main box offered to the custodian: ${labels.join(' | ')}`)
await shot('83-receipt-own-box')

// صفحة الخزينة: صندوقه والبنوك فقط
await page.goto(`${base}/treasury`)
if (await page.getByText('النقدية لدى أصحاب العهدة').count()) errors.push('custody summary shown to a restricted employee')
if (await page.getByRole('link', { name: 'الصندوق الرئيسي' }).count()) errors.push('main box visible to a restricted employee')
await shot('84-treasury-employee')

console.log(JSON.stringify({ username, boxOptions: labels, errors }))
await browser.close()
if (errors.length) process.exitCode = 1
