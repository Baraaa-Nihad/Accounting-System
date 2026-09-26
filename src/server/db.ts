import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@/generated/prisma/client'

/**
 * اتصال Prisma الوحيد في التطبيق (يُعاد استخدامه أثناء التطوير لتجنب فتح اتصالات كثيرة).
 */
function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> }

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

export type Tx = Prisma.TransactionClient
export type DbOrTx = typeof db | Tx

/** تنفيذ عملية كاملة داخل معاملة واحدة (إما أن تنجح كلها أو لا يُحفظ شيء). */
export function transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }): Promise<T> {
  return db.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: options?.timeout ?? 60_000,
    maxWait: 15_000,
  })
}

export { Prisma }
