import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** فحص النسخ الاحتياطي من المتصفح: إنشاء، تحقق، تنزيل، رفع، استعادة، ثم الدخول من جديد. */
const base = process.env.BASE_URL || 'http://localhost:3100'
const out = process.env.OUT_DIR || '.'
const pass = process.env.P || 'Admin@2026x'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('caret-color')) errors.push(m.text()) })
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true })

async function login() {
  await page.goto(`${base}/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', pass)
  await page.click('button[type=submit]')
  await page.waitForURL(`${base}/`)
}

await login()
await page.goto(`${base}/settings/backups`)
await page.getByRole('button', { name: 'نسخ احتياطي الآن' }).click()
await page.getByText('تم إنشاء النسخة الاحتياطية المشفرة').waitFor({ timeout: 60000 })
await page.reload()
await shot('120-backups')

const name = (await page.locator('tbody tr').first().locator('bdi', { hasText: 'backup-' }).first().innerText()).trim()
await page.locator('tbody tr').first().getByRole('button', { name: 'تحقق' }).click()
await page.getByText(/النسخة سليمة/).waitFor({ timeout: 60000 })

const dl = await page.request.get(`${base}/api/backups/${name}`)
const body = await dl.body()
if (dl.status() !== 200 || body.subarray(0, 5).toString() !== 'SABK1') errors.push(`download ${dl.status()}`)
const local = path.join(os.tmpdir(), name)
await writeFile(local, body)
await page.locator('input[aria-label="ملف نسخة احتياطية"]').setInputFiles(local)
await page.getByText('تم رفع النسخة والتحقق منها').waitFor({ timeout: 60000 })
await page.reload()
await shot('121-backups-uploaded')

// الاستعادة (لنفس الحالة الحالية) ثم إعادة الدخول
const row = page.locator('tbody tr', { hasText: name }).first()
await row.getByRole('button', { name: 'استعادة' }).click()
const dlg = page.getByRole('dialog')
await dlg.locator('input[type=password]').fill(pass)
await dlg.locator('input').nth(1).fill('استعادة')
await dlg.getByRole('button', { name: 'استعادة الآن' }).click()
await page.waitForURL(/\/login/, { timeout: 120000 })
await login()
await page.goto(`${base}/audit?action=restore`)
if (!(await page.getByText(name).count())) errors.push('restore not in audit log')
await shot('122-audit-restore')
console.log(JSON.stringify({ name, errors }))
await browser.close()
