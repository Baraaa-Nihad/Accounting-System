import 'server-only'
import { z } from 'zod'
import { db, type DbOrTx } from './db'
import { todayInTimeZone, type DateOnly } from '@/lib/dates'
import type { FormatConfig } from '@/lib/format'

/**
 * إعدادات النظام: كل مجموعة تُخزن كقيمة JSON تحت مفتاحها في جدول settings،
 * وتُدمج دائمًا مع القيم الافتراضية حتى لا ينقص أي حقل.
 */

const numberingFormat = z.object({ prefix: z.string().max(12), padding: z.number().int().min(1).max(10) })

export const settingsSchemas = {
  school: z.object({
    name: z.string().min(1).max(200),
    nameEn: z.string().max(200).default(''),
    address: z.string().max(300).default(''),
    phone: z.string().max(60).default(''),
    email: z.string().max(120).default(''),
    website: z.string().max(200).default(''),
    taxNumber: z.string().max(60).default(''),
    logo: z.string().nullable().default(null), // اسم ملف الشعار داخل مجلد التخزين
  }),
  finance: z.object({
    currencyCode: z.string().min(3).max(3),
    currencySymbol: z.string().min(1).max(8),
    decimals: z.number().int().min(0).max(3),
    timezone: z.string().min(1),
    dateFormat: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy']),
    graceDays: z.number().int().min(0).max(90),
    weekStartDay: z.number().int().min(0).max(6),
    allowNegativeCash: z.boolean(),
    lowCashThreshold: z.number().min(0),
    countryDialCode: z.string().max(5),
  }),
  numbering: z.object({
    receipt: numberingFormat,
    voucher: numberingFormat,
    transfer: numberingFormat,
    bill: numberingFormat,
    journal: numberingFormat,
    student: numberingFormat,
    employee: numberingFormat,
  }),
  print: z.object({
    receiptPaper: z.enum(['A5', 'A4']),
    headerNote: z.string().max(300),
    footerNote: z.string().max(300),
    showLogo: z.boolean(),
    receiptSignatures: z.array(z.string().max(40)).max(4),
    voucherSignatures: z.array(z.string().max(40)).max(4),
  }),
  payroll: z.object({
    workDaysPerMonth: z.number().int().min(1).max(31),
    hoursPerDay: z.number().min(1).max(24),
    payDay: z.number().int().min(1).max(31),
    alertDaysBefore: z.number().int().min(0).max(15),
  }),
  security: z.object({
    maxFailedAttempts: z.number().int().min(3).max(20),
    lockMinutes: z.number().int().min(1).max(1440),
    sessionHours: z.number().int().min(1).max(72),
  }),
  backup: z.object({
    autoEnabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    retention: z.number().int().min(1).max(365),
  }),
}

export type SettingsKey = keyof typeof settingsSchemas
export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> }

export const DEFAULT_SETTINGS: Settings = {
  school: {
    name: 'المدرسة',
    nameEn: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    taxNumber: '',
    logo: null,
  },
  finance: {
    currencyCode: 'ILS',
    currencySymbol: '₪',
    decimals: 2,
    timezone: 'Asia/Hebron',
    dateFormat: 'dd/MM/yyyy',
    graceDays: 0,
    weekStartDay: 6,
    allowNegativeCash: false,
    lowCashThreshold: 500,
    countryDialCode: '970',
  },
  numbering: {
    receipt: { prefix: 'REC', padding: 6 },
    voucher: { prefix: 'PAY', padding: 6 },
    transfer: { prefix: 'TRF', padding: 6 },
    bill: { prefix: 'BILL', padding: 6 },
    journal: { prefix: 'JE', padding: 6 },
    student: { prefix: '', padding: 5 },
    employee: { prefix: 'EMP-', padding: 4 },
  },
  print: {
    receiptPaper: 'A5',
    headerNote: '',
    footerNote: 'هذا السند صادر من النظام المالي للمدرسة',
    showLogo: true,
    receiptSignatures: ['المستلم', 'المحاسب'],
    voucherSignatures: ['المستلم', 'المحاسب', 'المدير'],
  },
  payroll: {
    workDaysPerMonth: 30,
    hoursPerDay: 8,
    payDay: 28,
    alertDaysBefore: 3,
  },
  security: {
    maxFailedAttempts: 5,
    lockMinutes: 15,
    sessionHours: 12,
  },
  backup: {
    autoEnabled: true,
    hour: 2,
    minute: 0,
    retention: 14,
  },
}

// ذاكرة مؤقتة قصيرة لتقليل القراءات المتكررة داخل نفس الطلب
let cache: { value: Settings; at: number } | null = null
const CACHE_MS = 5_000

function merge<K extends SettingsKey>(key: K, stored: unknown): Settings[K] {
  const base = DEFAULT_SETTINGS[key] as Record<string, unknown>
  const merged = { ...base, ...(stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}) }
  const parsed = settingsSchemas[key].safeParse(merged)
  return (parsed.success ? parsed.data : DEFAULT_SETTINGS[key]) as Settings[K]
}

export async function getSettings(client: DbOrTx = db): Promise<Settings> {
  if (client === db && cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const rows = await client.setting.findMany()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const value = Object.fromEntries(
    (Object.keys(settingsSchemas) as SettingsKey[]).map((k) => [k, merge(k, map.get(k))]),
  ) as Settings
  if (client === db) cache = { value, at: Date.now() }
  return value
}

export async function getSetting<K extends SettingsKey>(key: K, client: DbOrTx = db): Promise<Settings[K]> {
  return (await getSettings(client))[key]
}

export async function saveSetting<K extends SettingsKey>(client: DbOrTx, key: K, value: Settings[K]): Promise<void> {
  const parsed = settingsSchemas[key].parse(value)
  await client.setting.upsert({
    where: { key },
    create: { key, value: parsed as object },
    update: { value: parsed as object },
  })
  cache = null
}

export function invalidateSettingsCache() {
  cache = null
}

export async function getFormatConfig(client: DbOrTx = db): Promise<FormatConfig> {
  const { finance } = await getSettings(client)
  return {
    currencySymbol: finance.currencySymbol,
    currencyCode: finance.currencyCode,
    decimals: finance.decimals,
    dateFormat: finance.dateFormat,
    timezone: finance.timezone,
  }
}

/** تاريخ اليوم بتوقيت المدرسة. */
export async function today(client: DbOrTx = db): Promise<DateOnly> {
  const { finance } = await getSettings(client)
  return todayInTimeZone(finance.timezone)
}

export async function moneyDecimals(client: DbOrTx = db): Promise<number> {
  return (await getSettings(client)).finance.decimals
}
