import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import { getSetting } from '@/server/settings'
import { storageRoot } from '@/server/storage'
import { detectFileType } from '@/server/services/attachments'

/** شعار المدرسة (يُعرض في صفحة الدخول والسندات المطبوعة). */
export async function GET() {
  const school = await getSetting('school')
  if (!school.logo || school.logo.includes('..')) return new NextResponse(null, { status: 404 })
  try {
    const data = await readFile(path.join(storageRoot(), 'branding', path.basename(school.logo)))
    const type = detectFileType(data)
    if (!type || !type.mime.startsWith('image/')) return new NextResponse(null, { status: 404 })
    return new NextResponse(new Uint8Array(data), { headers: { 'Content-Type': type.mime, 'Cache-Control': 'private, max-age=300' } })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
