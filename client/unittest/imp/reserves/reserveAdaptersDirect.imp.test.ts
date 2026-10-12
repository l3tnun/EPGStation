import { describe, expect, it } from 'vitest'
import {
  adaptChannelIndex,
  adaptReserveItem,
  hydrateReserveChannelNames,
} from '@/features/reserves/lib/reserveAdapters'

describe('reserveAdapters direct unit edges', () => {
  it('[AC 2.6] rejects non-record payloads for adaptReserveItem', () => {
    expect(adaptReserveItem(null)).toBeNull()
    expect(adaptReserveItem('not-a-record')).toBeNull()
    expect(adaptReserveItem(42)).toBeNull()
  })

  it('[AC 2.6] adopts a raw channelName string field directly, without requiring hydration', () => {
    expect(
      adaptReserveItem({
        id: 1,
        channelId: 5,
        channelName: 'Direct channel name',
      }),
    ).toMatchObject({
      id: 1,
      channelId: 5,
      channelName: 'Direct channel name',
    })
  })

  it('[AC 2.6] carries channelType BS4K through as a recognized broadcast wave', () => {
    expect(adaptReserveItem({ id: 1, channelType: 'BS4K' })).toMatchObject({
      id: 1,
      channelType: 'BS4K',
    })
    expect(adaptReserveItem({ id: 2, channelType: 'UNKNOWN' })).not.toHaveProperty('channelType')
  })

  it('[AC 2.6] drops endAt when it precedes startAt on a raw reserve item', () => {
    const startAt = Date.parse('2026-05-05T10:45:00+09:00')
    const endAt = Date.parse('2026-05-05T10:15:00+09:00')

    const item = adaptReserveItem({ id: 1, startAt, endAt })

    expect(item).toMatchObject({ id: 1, startAt })
    expect(item?.endAt).toBeUndefined()
  })

  it('[AC 2.6] derives a genre3-only display label when no explicit genres array is present', () => {
    const item = adaptReserveItem({ id: 1, genre3: 9, subGenre3: 4 })

    expect(item).toMatchObject({
      id: 1,
      genre3: 9,
      subGenre3: 4,
      genres: ['genre 9/4'],
    })
  })

  it('[AC 2.6] skips a malformed entry inside the channel index array', () => {
    const index = adaptChannelIndex([
      null,
      'not-a-record',
      { id: -1, name: 'Invalid id' },
      { id: 10, name: 'Valid entry' },
    ])

    expect(index).toStrictEqual(new Map([[10, 'Valid entry']]))
  })

  it('[AC 2.6] prefers name over halfWidthName absence, and drops entries with neither', () => {
    const index = adaptChannelIndex([{ id: 1, name: 'Full width only' }, { id: 2 }])

    expect(index).toStrictEqual(new Map([[1, 'Full width only']]))
  })

  it('[AC 2.6] hydrateReserveChannelNames leaves items untouched when a channel name already exists', () => {
    const response = {
      reserves: [{ id: 1, channelId: 5, channelName: 'Existing name' }],
      total: 1,
    }

    expect(hydrateReserveChannelNames(response, new Map([[5, 'Looked up name']]))).toStrictEqual(
      response,
    )
  })

  it('[AC 2.6] hydrateReserveChannelNames leaves items untouched when channelId is absent', () => {
    const response = { reserves: [{ id: 1 }], total: 1 }

    expect(hydrateReserveChannelNames(response, new Map([[5, 'Looked up name']]))).toStrictEqual(
      response,
    )
  })

  it('[AC 2.6] hydrateReserveChannelNames leaves items untouched when the channel index has no match', () => {
    const response = { reserves: [{ id: 1, channelId: 99 }], total: 1 }

    expect(hydrateReserveChannelNames(response, new Map([[5, 'Looked up name']]))).toStrictEqual(
      response,
    )
  })
})
