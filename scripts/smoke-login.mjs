import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1366, height: 860 }, locale: 'ar' })
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()) })
page.on('pageerror', (e) => console.log('page error:', e.message))
await page.goto(`${base}/login`)
await page.screenshot({ path: `${out}/01-login.png` })
await page.fill('#username', process.env.U || 'admin')
await page.fill('#password', process.env.P || 'Admin@12345')
await page.click('button[type=submit]')
await page.waitForLoadState('networkidle')
console.log('after login url:', page.url())
await page.screenshot({ path: `${out}/02-after-login.png` })
if (page.url().includes('change-password')) {
  const inputs = page.locator('input[type=password]')
  await inputs.nth(0).fill(process.env.P || 'Admin@12345')
  await inputs.nth(1).fill('Admin@2026x')
  await inputs.nth(2).fill('Admin@2026x')
  await page.click('button[type=submit]')
  await page.waitForURL(`${base}/`, { timeout: 15000 }).catch(() => {})
  await page.waitForLoadState('networkidle')
  console.log('after change url:', page.url())
}
await page.screenshot({ path: `${out}/03-home.png` })
await browser.close()
