import { NextResponse } from 'next/server'
import { db } from '@/server/db'

/** فحص الصحة (للحاويات والمراقبة): الخادم يعمل وقاعدة البيانات تستجيب. لا يكشف أي بيانات. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
