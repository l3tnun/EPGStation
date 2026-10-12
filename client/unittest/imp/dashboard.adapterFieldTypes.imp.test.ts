import { describe, expect, it } from 'vitest'
import {
  adaptChannelIndex,
  adaptRecordsResponse,
  hydrateRecordedChannelNames,
} from '@/features/dashboard/lib/dashboardRecordedAdapters'
import { adaptReserveCounts } from '@/features/dashboard/lib/dashboardReserveAdapters'

describe('dashboard record adapters', () => {
  it('turns a record or video file that is not an object into an empty one', () => {
    expect(
      adaptRecordsResponse({ records: [null, { videoFiles: [null] }], total: 2 }),
    ).toStrictEqual({
      records: [{}, { videoFiles: [{}] }],
      total: 2,
    })
  })

  it('keeps a drop log only when all counters are numbers and its id only when numeric', () => {
    const dropLog = { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 }
    const adapt = (dropLogFile: unknown) =>
      adaptRecordsResponse({ records: [{ dropLogFile }], total: 1 })?.records[0]

    expect(adapt({ ...dropLog, id: 'x' })).toStrictEqual({
      dropLogFile: { id: undefined, ...dropLog },
    })
    expect(adapt({ ...dropLog, id: 4 })).toStrictEqual({ dropLogFile: { id: 4, ...dropLog } })
    for (const key of ['dropCnt', 'errorCnt', 'scramblingCnt']) {
      expect(adapt({ ...dropLog, [key]: 'x' })).toStrictEqual({})
    }
  })

  it('ignores a non-string name of a channel and keeps a given channel name', () => {
    expect(adaptChannelIndex([null, { id: 1, name: 5 }, { id: 2, name: 'Two' }])).toStrictEqual(
      new Map([[2, 'Two']]),
    )

    const given = { channelId: 1, channelName: 'Given' }
    expect(
      hydrateRecordedChannelNames({ records: [given], total: 1 }, new Map([[1, 'Indexed']]))
        .records,
    ).toStrictEqual([given])
  })
})

describe('dashboard reserve counts', () => {
  it('requires all four counts to be numbers', () => {
    const counts = { normal: 1, conflicts: 2, skips: 3, overlaps: 4 }

    expect(adaptReserveCounts(counts)).toStrictEqual(counts)
    for (const key of ['normal', 'conflicts', 'skips', 'overlaps']) {
      expect(adaptReserveCounts({ ...counts, [key]: '1' })).toBeNull()
    }
    expect(adaptReserveCounts(null)).toBeNull()
  })
})
