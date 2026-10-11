import { describe, expect, it } from 'vitest'
import { adaptReserveLists, adaptSchedules } from '@/features/onair/lib/onairApiAdapters'
import { adaptChannelNameIndex } from '@/features/onair/lib/onairLiveStreamAdapters'

describe('on-air API adapter edges', () => {
  it('rejects reserve lists unless all four lists are valid', () => {
    const valid = { normal: [], conflicts: [], skips: [], overlaps: [] }

    expect(adaptReserveLists(valid)).toStrictEqual(valid)
    for (const key of ['normal', 'conflicts', 'skips', 'overlaps']) {
      expect(adaptReserveLists({ ...valid, [key]: 'x' })).toBeNull()
    }
  })

  it('turns a schedule entry that is not an object into an empty schedule', () => {
    expect(adaptSchedules([null, 'x', {}])).toStrictEqual([{}, {}, {}])
  })

  it('indexes only channels with a numeric id', () => {
    expect(
      adaptChannelNameIndex(
        [null, 'x', { id: 'x', name: 'string id' }, { id: 1, name: 'One' }, { id: 2, name: 5 }],
        false,
      ),
    ).toStrictEqual(new Map([[1, 'One']]))
  })
})
