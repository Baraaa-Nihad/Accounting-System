import { chromium } from 'playwright-core'
const base = 'http://localhost:3100'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1440), height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`${base}/login`)
await page.fill('#username', 'admin')
await page.fill('#password', 'Admin@2026x')
await page.click('button[type=submit]')
await page.waitForURL(`${base}/`)
for (const [path, name] of process.argv.slice(3).map((a) => { const i = a.lastIndexOf('='); return [a.slice(0, i), a.slice(i + 1)] })) {
  const res = await page.goto(`${base}${path}`)
  await page.waitForLoadState('networkidle')
  if (res && res.status() >= 400) errors.push(`${path} -> ${res.status()}`)
  if (name !== '-') await page.screenshot({ path: `${process.argv[2]}/${name}.png`, fullPage: true })
}
console.log('errors', JSON.stringify(errors))
await browser.close()
