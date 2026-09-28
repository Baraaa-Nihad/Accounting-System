import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

/**
 * فحص نظام منشور خلف خادم الويب (يستخدمه اختبار التثبيت على الخادم):
 * الدخول (مع تغيير كلمة المرور الإلزامي عند أول دخول)، لوحة التحكم، وتوليد PDF بـ Chromium داخل الحاوية.
 *   BASE_URL=http://school.test P=كلمة-المرور [NEW_P=كلمة-جديدة] node scripts/deploy-check.mjs
 */
const base = process.env.BASE_URL
const out = process.env.OUT_DIR || 'deploy-check'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome' })
const page = await browser.newPage({ viewport: { width: 1366, height: 860 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })

try {
  await page.goto(`${base}/login`)
  await page.fill('#username', process.env.U || 'admin')
  await page.fill('#password', process.env.P)
  await page.click('button[type=submit]')
  if (process.env.NEW_P) {
    await page.waitForURL(`${base}/change-password`, { timeout: 30000 })
    await page.locator('input[autocomplete=current-password]').fill(process.env.P)
    await page.locator('input[autocomplete=new-password]').first().fill(process.env.NEW_P)
    await page.locator('input[autocomplete=new-password]').nth(1).fill(process.env.NEW_P)
    await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click()
  }
  await page.waitForURL(`${base}/`, { timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${out}/dashboard.png` })

  const cookie = (await page.context().cookies()).find((c) => c.name === 'sa_session')
  if (!cookie?.httpOnly) throw new Error('session cookie missing or not httpOnly')
  if (base.startsWith('https:') && !cookie.secure) throw new Error('session cookie is not secure over HTTPS')

  const pdf = await page.request.get(`${base}/api/pdf/reports/trial-balance`)
  const body = await pdf.body()
  if (pdf.status() !== 200 || body.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error(`PDF generation failed: ${pdf.status()} ${body.subarray(0, 300).toString()}`)
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ ok: true, url: page.url(), pdfBytes: body.length }))
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
