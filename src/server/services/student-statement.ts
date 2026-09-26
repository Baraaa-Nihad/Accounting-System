import 'server-only'
import { db } from '../db'
import { accountIdByKey } from '../ledger/accounts'
import { statement } from '../ledger/statements'
import type { DateOnly } from '@/lib/dates'

export async function studentStatement(studentId: number, opts: { from?: DateOnly | null; to?: DateOnly | null; hideReversed?: boolean }) {
  const ar = await accountIdByKey(db, 'AR_STUDENTS')
  return statement(db, { accountIds: [ar], studentId, from: opts.from ?? null, to: opts.to ?? null, hideReversed: opts.hideReversed }, 1)
}
