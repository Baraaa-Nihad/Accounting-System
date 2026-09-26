import { normalizeArabic } from '@/lib/arabic'
import type { ImportField } from './types'

const norm = (s: string) =>
  normalizeArabic(s)
    .replace(/[*:()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * الربط التلقائي بين أعمدة الملف وحقول النظام بمطابقة الاسم والمرادفات (عربي/إنجليزي).
 * كل عمود يُستخدم لحقل واحد فقط، والمطابقة التامة تسبق الجزئية.
 */
export function autoMap(headers: string[], fields: ImportField[]): Record<string, number | null> {
  const nh = headers.map(norm)
  const used = new Set<number>()
  const mapping: Record<string, number | null> = {}
  const names = (f: ImportField) => [f.label, ...(f.synonyms ?? [])].map(norm)
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of fields) {
      if (mapping[f.key] !== undefined && mapping[f.key] !== null) continue
      const candidates = names(f)
      const idx = nh.findIndex((h, i) => {
        if (used.has(i) || !h) return false
        return pass === 'exact' ? candidates.includes(h) : candidates.some((c) => c.length >= 3 && (h.includes(c) || c.includes(h)) && h.length >= 3)
      })
      if (idx >= 0) {
        mapping[f.key] = idx
        used.add(idx)
      } else if (pass === 'contains') mapping[f.key] = null
    }
  }
  return mapping
}
