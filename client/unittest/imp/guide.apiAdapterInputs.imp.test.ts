import { describe, expect, it } from 'vitest'
import { createFetchGuideApiRepository } from '@/features/guide/guideApi'
import {
  adaptReserveLists,
  adaptSchedule,
  fetchAction,
} from '@/features/guide/lib/guideApiAdapters'

describe('guide API adapter inputs', () => {
  it('turns a schedule entry that is not an object into an empty schedule', () => {
    expect(adaptSchedule([null, 'x', {}])).toStrictEqual([{}, {}, {}])
  })

  it('rejects reserve lists unless all four lists are valid', () => {
    const valid = { normal: [], conflicts: [], skips: [], overlaps: [] }

    expect(adaptReserveLists(valid)).toStrictEqual(valid)
    for (const key of ['normal', 'conflicts', 'skips', 'overlaps']) {
      expect(adaptReserveLists({ ...valid, [key]: 'x' })).toBeNull()
    }
  })

  it('reports false instead of rejecting when an action request throws', async () => {
    await expect(
      fetchAction(async () => {
        throw new Error('network')
      }, '/x'),
    ).resolves.toBe(false)
    await expect(
      createFetchGuideApiRepository({
        fetcher: async () => {
          throw new Error('network')
        },
      }).triggerReserveUpdate(),
    ).resolves.toMatchObject({ ok: false, error: 'guide-reserve-update-failed' })
  })
})
