import { describe, expect, it, vi } from 'vitest'
import {
  adaptAddReserveResponse,
  adaptReserveItem,
  adaptReserveList,
  adaptReserveLists,
  adaptSchedule,
  fetchJson,
} from '@/features/guide/lib/guideApiAdapters'

describe('Guide API adapter malformed-payload branches', () => {
  it('rejects a schedule payload whose root is not an array', () => {
    expect(adaptSchedule({ not: 'an array' })).toBeNull()
  })

  it('drops entries with non-record channel/program field types instead of copying them', () => {
    const result = adaptSchedule([
      {
        channel: {
          id: 'not-a-number',
          name: 42,
          type: 'not-a-number',
        },
        programs: [
          {
            id: 'x',
            name: 1,
            description: 2,
            startAt: 'x',
            endAt: 'x',
            channelId: 'x',
            genre1: 'x',
            subGenre1: 'x',
            genre2: 'x',
            subGenre2: 'x',
            genre3: 'x',
            subGenre3: 'x',
            extended: 3,
            videoComponentType: 'x',
            audioComponentType: 'x',
            audioSamplingRate: 'x',
            isFree: 'x',
          },
        ],
      },
    ])

    expect(result).toStrictEqual([
      {
        channel: {},
        programs: [{}],
      },
    ])
  })

  it('leaves channel and programs unset when they are absent from the schedule entry', () => {
    expect(adaptSchedule([{}])).toStrictEqual([{}])
  })

  it('resolves fetchJson to null when the fetcher throws', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down')
    })

    await expect(fetchJson(fetcher, '/api/schedules')).resolves.toBeNull()
  })

  it('rejects a reserve item payload that is not a record', () => {
    expect(adaptReserveItem('not-a-record')).toBeNull()
    expect(adaptReserveItem(null)).toBeNull()
  })

  it('falls back to the id field when reserveId is not a number', () => {
    expect(adaptReserveItem({ id: 7 })).toStrictEqual({ id: 7 })
  })

  it('rejects a reserve item payload whose id and reserveId are both non-numeric', () => {
    expect(adaptReserveItem({ id: 'not-a-number' })).toBeNull()
  })

  it('adapts a reserve item without optional programId/ruleId fields', () => {
    expect(adaptReserveItem({ reserveId: 5 })).toStrictEqual({ id: 5 })
  })

  it('rejects an add-reserve response payload without a numeric reserveId', () => {
    expect(adaptAddReserveResponse({ reserveId: 'x' })).toBeNull()
    expect(adaptAddReserveResponse(null)).toBeNull()
  })

  it('rejects a reserve list payload whose root is not an array', () => {
    expect(adaptReserveList({ not: 'an array' })).toBeNull()
  })

  it('rejects a reserve list containing a malformed item', () => {
    expect(adaptReserveList([{ reserveId: 1 }, { bad: true }])).toBeNull()
  })

  it('rejects a reserve lists payload that is not a record', () => {
    expect(adaptReserveLists('not-a-record')).toBeNull()
  })

  it('rejects a reserve lists payload with a malformed sub-list', () => {
    expect(
      adaptReserveLists({
        normal: [{ reserveId: 1 }],
        conflicts: [{ bad: true }],
        skips: [],
        overlaps: [],
      }),
    ).toBeNull()
  })
})
