import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** بناء رابط مع تحديث معاملات البحث (للفلاتر والترقيم). */
export function withParams(
  path: string,
  current: Record<string, string | string[] | undefined>,
  updates: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x))
    else params.set(k, v)
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === '') params.delete(k)
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function intParam(value: string | string[] | undefined): number | undefined {
  const v = firstParam(value)
  if (!v) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
