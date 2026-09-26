import 'server-only'
import { existsSync } from 'node:fs'

/**
 * توليد PDF على الخادم عبر متصفح Chromium (أدق عرض للنص العربي).
 * اختياري: إذا لم يتوفر Chromium تبقى الطباعة متاحة عبر المتصفح («حفظ كـ PDF»).
 */

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium',
].filter((p): p is string => !!p)

export function chromiumPath(): string | null {
  for (const p of CANDIDATES) if (existsSync(p)) return p
  return null
}

export function pdfAvailable(): boolean {
  return chromiumPath() !== null
}

export async function renderPdf(url: string, cookie: { name: string; value: string }): Promise<Buffer> {
  const executablePath = chromiumPath()
  if (!executablePath) throw new Error('CHROMIUM_NOT_AVAILABLE')
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ locale: 'ar' })
    const u = new URL(url)
    await context.addCookies([{ name: cookie.name, value: cookie.value, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, format: 'A4' })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
