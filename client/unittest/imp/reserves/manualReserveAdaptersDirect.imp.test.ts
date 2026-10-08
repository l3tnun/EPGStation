import { describe, expect, it } from 'vitest'
import { adaptManualProgramDetail } from '@/features/reserves/lib/manualReserveAdapters'

describe('manualReserveAdapters direct unit edges', () => {
  it('[AC 4.13] rejects a non-record program payload before validating its fields', () => {
    expect(adaptManualProgramDetail(null)).toBeNull()
    expect(adaptManualProgramDetail('not-a-record')).toBeNull()
    expect(adaptManualProgramDetail(42)).toBeNull()
  })
})
