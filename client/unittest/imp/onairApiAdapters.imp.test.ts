import { describe, expect, it, vi } from 'vitest'
import type { ServerApiFetch } from '@/app/serverApi'
import {
  adaptAddReserveResponse,
  adaptChannel,
  adaptProgram,
  adaptReserveItem,
  adaptReserveList,
  adaptReserveLists,
  adaptSchedules,
  fetchAction,
  fetchJson,
  isRecord,
  resolveDefaultFetch,
} from '@/features/onair/lib/onairApiAdapters'

describe('onairApiAdapters malformed payload guards', () => {
  it('resolveDefaultFetch binds globalThis.fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const fetcher = resolveDefaultFetch()

    await fetcher('https://example.invalid/')

    expect(fetchSpy).toHaveBeenCalledWith('https://example.invalid/')
    fetchSpy.mockRestore()
  })

  it('isRecord rejects non-object and null values', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('text')).toBe(false)
    expect(isRecord(42)).toBe(false)
  })

  it('fetchJson returns null when the response is not ok', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => new Response('{}', { status: 500 }))

    await expect(fetchJson(fetcher, '/api/x')).resolves.toBeNull()
  })

  it('fetchJson returns null when the fetcher throws', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => {
      throw new Error('network down')
    })

    await expect(fetchJson(fetcher, '/api/x')).resolves.toBeNull()
  })

  it('fetchJson uses the provided init and parses json on success', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => new Response(JSON.stringify({ a: 1 })))

    await expect(fetchJson(fetcher, '/api/x', { method: 'POST' })).resolves.toStrictEqual({ a: 1 })
    expect(fetcher).toHaveBeenCalledWith('/api/x', { method: 'POST' })
  })

  it('fetchAction returns false when the fetcher throws', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => {
      throw new Error('network down')
    })

    await expect(fetchAction(fetcher, '/api/x')).resolves.toBe(false)
  })

  it('fetchAction returns the response ok flag', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => new Response('{}', { status: 500 }))

    await expect(fetchAction(fetcher, '/api/x')).resolves.toBe(false)
  })

  it('adaptReserveItem rejects non-record values and values missing a numeric reserveId', () => {
    expect(adaptReserveItem(null)).toBeNull()
    expect(adaptReserveItem({ reserveId: 'not-a-number' })).toBeNull()
  })

  it('adaptReserveItem carries optional programId and ruleId only when numeric', () => {
    expect(adaptReserveItem({ reserveId: 1 })).toStrictEqual({ reserveId: 1 })
    expect(adaptReserveItem({ reserveId: 1, programId: 2, ruleId: 3 })).toStrictEqual({
      reserveId: 1,
      programId: 2,
      ruleId: 3,
    })
  })

  it('adaptReserveList rejects non-array values and propagates a single malformed entry as null', () => {
    expect(adaptReserveList('not-an-array')).toBeNull()
    expect(adaptReserveList([{ reserveId: 1 }, { reserveId: 'bad' }])).toBeNull()
    expect(adaptReserveList([{ reserveId: 1 }])).toStrictEqual([{ reserveId: 1 }])
  })

  it('adaptReserveLists rejects a non-record payload', () => {
    expect(adaptReserveLists(null)).toBeNull()
  })

  it('adaptReserveLists rejects when any of the four lists is malformed', () => {
    const valid = { reserveId: 1 }
    expect(
      adaptReserveLists({
        normal: [valid],
        conflicts: 'not-an-array',
        skips: [valid],
        overlaps: [valid],
      }),
    ).toBeNull()
  })

  it('adaptReserveLists returns all four normalized lists on success', () => {
    const valid = { reserveId: 1 }
    expect(
      adaptReserveLists({
        normal: [valid],
        conflicts: [],
        skips: [],
        overlaps: [],
      }),
    ).toStrictEqual({
      normal: [{ reserveId: 1 }],
      conflicts: [],
      skips: [],
      overlaps: [],
    })
  })

  it('adaptChannel returns undefined for a non-record value', () => {
    expect(adaptChannel(null)).toBeUndefined()
  })

  it('adaptChannel accepts every channelType enum member and drops unrecognized ones', () => {
    expect(adaptChannel({ channelType: 'BS' })).toStrictEqual({ channelType: 'BS' })
    expect(adaptChannel({ channelType: 'CS' })).toStrictEqual({ channelType: 'CS' })
    expect(adaptChannel({ channelType: 'SKY' })).toStrictEqual({ channelType: 'SKY' })
    expect(adaptChannel({ channelType: 'BS4K' })).toStrictEqual({ channelType: 'BS4K' })
    expect(adaptChannel({ channelType: 'UNKNOWN' })).toStrictEqual({})
  })

  it('adaptChannel carries id, name, and hasLogoData only when they match the expected type', () => {
    expect(adaptChannel({ id: 1, name: 'ch', hasLogoData: true, extra: 'ignored' })).toStrictEqual({
      id: 1,
      name: 'ch',
      hasLogoData: true,
    })
    expect(adaptChannel({ id: 'bad', name: 2, hasLogoData: 'bad' })).toStrictEqual({})
  })

  it('adaptProgram returns null for a non-record value', () => {
    expect(adaptProgram(null)).toBeNull()
  })

  it('adaptProgram carries every optional numeric/string/boolean field only when well typed', () => {
    const fullPayload = {
      id: 1,
      name: 'n',
      description: 'd',
      extended: 'e',
      startAt: 1,
      endAt: 2,
      channelId: 3,
      genre1: 4,
      subGenre1: 5,
      genre2: 6,
      subGenre2: 7,
      genre3: 8,
      subGenre3: 9,
      videoComponentType: 10,
      audioComponentType: 11,
      audioSamplingRate: 12,
      isFree: true,
    }
    expect(adaptProgram(fullPayload)).toStrictEqual(fullPayload)

    const malformedPayload = {
      id: '1',
      name: 2,
      description: 3,
      extended: 4,
      startAt: '1',
      endAt: '2',
      channelId: '3',
      genre1: '4',
      subGenre1: '5',
      genre2: '6',
      subGenre2: '7',
      genre3: '8',
      subGenre3: '9',
      videoComponentType: '10',
      audioComponentType: '11',
      audioSamplingRate: '12',
      isFree: 'true',
    }
    expect(adaptProgram(malformedPayload)).toStrictEqual({})
  })

  it('adaptAddReserveResponse rejects a non-record value or a missing numeric reserveId', () => {
    expect(adaptAddReserveResponse(null)).toBeNull()
    expect(adaptAddReserveResponse({ reserveId: 'bad' })).toBeNull()
    expect(adaptAddReserveResponse({ reserveId: 5 })).toStrictEqual({ reserveId: 5 })
  })

  it('adaptSchedules rejects a non-array payload', () => {
    expect(adaptSchedules('not-an-array')).toBeNull()
  })

  it('adaptSchedules coerces a non-record entry to an empty schedule', () => {
    expect(adaptSchedules(['not-a-record'])).toStrictEqual([{}])
  })

  it('adaptSchedules omits channel/programs fields that fail to normalize and filters malformed programs', () => {
    expect(
      adaptSchedules([
        {
          channel: null,
          programs: 'not-an-array',
        },
      ]),
    ).toStrictEqual([{}])

    expect(
      adaptSchedules([
        {
          channel: { id: 1 },
          programs: [{ id: 10 }, 'not-a-record'],
        },
      ]),
    ).toStrictEqual([
      {
        channel: { id: 1 },
        programs: [{ id: 10 }],
      },
    ])
  })
})
