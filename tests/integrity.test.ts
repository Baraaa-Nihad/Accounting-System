import { describe, expect, it } from 'vitest'
import { db } from '@/server/db'
import { runIntegrityChecks } from '@/server/services/integrity'

describe('integrity checks', () => {
  it('all reconciliation rules pass on the test data', async () => {
    const checks = await runIntegrityChecks(db)
    expect(checks.length).toBeGreaterThanOrEqual(10)
    const failed = checks.filter((c) => !c.ok).map((c) => ({ key: c.key, count: c.count, issues: c.issues.slice(0, 5) }))
    expect(failed).toEqual([])
  })
})
