import 'server-only'
import type { Tx } from './db'
import { getSettings } from './settings'
import type { DateOnly } from '@/lib/dates'

/**
 * ترقيم المستندات (docs/11-numbering.md):
 * العداد يُحجز داخل نفس معاملة حفظ المستند؛ الأمر INSERT ... ON CONFLICT يقفل صف العداد
 * حتى نهاية المعاملة، فلا يتكرر رقم، وإذا فشل الحفظ يُلغى الحجز فلا تنشأ فجوة.
 */

export type YearlySequence = 'receipt' | 'voucher' | 'transfer' | 'bill' | 'journal'
export type PlainSequence = 'student' | 'employee'

async function bump(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "number_sequences" ("key", "lastValue", "updatedAt")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE
      SET "lastValue" = "number_sequences"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`
  return Number(rows[0].lastValue)
}

/** رقم مستند سنوي: REC-2026-000001 (السنة = السنة الميلادية لتاريخ المستند). */
export async function nextDocumentNumber(tx: Tx, type: YearlySequence, date: DateOnly): Promise<string> {
  const { numbering } = await getSettings(tx)
  const fmt = numbering[type]
  const year = date.slice(0, 4)
  const value = await bump(tx, `${type.toUpperCase()}:${year}`)
  const serial = String(value).padStart(fmt.padding, '0')
  return fmt.prefix ? `${fmt.prefix}-${year}-${serial}` : `${year}-${serial}`
}

/** رقم متسلسل غير مرتبط بسنة (رقم الطالب، الرقم الوظيفي). يتجاوز الأرقام المستخدمة يدويًا. */
export async function nextPlainNumber(
  tx: Tx,
  type: PlainSequence,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const { numbering } = await getSettings(tx)
  const fmt = numbering[type]
  for (let attempt = 0; attempt < 1000; attempt++) {
    const value = await bump(tx, type.toUpperCase())
    const candidate = `${fmt.prefix}${String(value).padStart(fmt.padding, '0')}`
    if (!(await isTaken(candidate))) return candidate
  }
  throw new Error('NUMBERING_EXHAUSTED')
}
