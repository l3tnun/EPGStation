import { describe, expect, it, vi } from 'vitest'
import { createFetchGuideApiRepository, type GuideApiRepository } from '@/features/guide/guideApi'

describe('Guide API repository adapter edges', () => {
  const scheduleRequest = {
    mode: 'normal' as const,
    startAt: 1_000,
    endAt: 2_000,
    isHalfWidth: true,
    isFree: false,
    GR: true,
    BS: false,
    CS: false,
    SKY: false,
    BS4K: false,
  }

  it('adapts schedule, reserve index, reserve add, and action endpoints', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.startsWith('/api/schedules?')) {
        return new Response(
          JSON.stringify([
            {
              channel: { id: 1, name: 'Channel', type: 0 },
              programs: [
                {
                  id: 10,
                  name: 'Program',
                  description: 'description',
                  startAt: 1_000,
                  endAt: 2_000,
                  channelId: 1,
                  genre1: 7,
                  subGenre1: 1,
                  genre2: 8,
                  subGenre2: 2,
                  genre3: 9,
                  subGenre3: 3,
                  extended: 'extended',
                  videoComponentType: 1,
                  audioComponentType: 2,
                  audioSamplingRate: 3,
                  isFree: true,
                },
                'bad',
              ],
            },
            'bad',
          ]),
        )
      }
      if (href.startsWith('/api/reserves/lists?')) {
        return new Response(
          JSON.stringify({
            normal: [{ reserveId: 1, programId: 10, ruleId: 100 }],
            conflicts: [],
            skips: [],
            overlaps: [],
          }),
        )
      }
      if (href === '/api/reserves' && init?.method === 'POST') {
        return new Response(JSON.stringify({ reserveId: 50 }))
      }
      return new Response(null, { status: 204 })
    })
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.fetchSchedule(scheduleRequest)).resolves.toStrictEqual({
      ok: true,
      value: [
        {
          channel: { id: 1, name: 'Channel', type: 0 },
          programs: [
            {
              id: 10,
              name: 'Program',
              description: 'description',
              startAt: 1_000,
              endAt: 2_000,
              channelId: 1,
              genre1: 7,
              subGenre1: 1,
              genre2: 8,
              subGenre2: 2,
              genre3: 9,
              subGenre3: 3,
              extended: 'extended',
              videoComponentType: 1,
              audioComponentType: 2,
              audioSamplingRate: 3,
              isFree: true,
            },
          ],
        },
        {},
      ],
    })
    await expect(repository.fetchReserveIndex({ startAt: 1_000, endAt: 2_000 })).resolves.toEqual({
      ok: true,
      value: {
        10: {
          type: 'reserve',
          item: { id: 1, programId: 10, ruleId: 100 },
        },
      },
    })
    await expect(
      repository.addProgramReserve({ programId: 10, allowEndLack: true }),
    ).resolves.toEqual({
      ok: true,
      value: { reserveId: 50 },
    })
    await expect(repository.triggerReserveUpdate()).resolves.toEqual({ ok: true, value: {} })
    await expect(repository.deleteReserve(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.unlockSkipReserve(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.unlockOverlapReserve(1)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
  })

  it('returns typed failures for malformed payloads and failed actions', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url)
      if (href.startsWith('/api/schedules/999?')) {
        return new Response(null, { status: 404 })
      }
      if (href.includes('/reserves/update')) {
        throw new Error('network')
      }
      if (href.includes('/reserves/')) {
        return new Response(null, { status: 500 })
      }
      return new Response(JSON.stringify({}))
    })
    const repository = createFetchGuideApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchSchedule({
        mode: 'singleChannel',
        channelId: 999,
        startAt: 1_000,
        days: 8,
        isHalfWidth: true,
        isFree: false,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'guide-channel-not-found' })
    await expect(repository.fetchSchedule(scheduleRequest)).resolves.toMatchObject({
      ok: false,
      error: 'guide-schedule-fetch-failed',
    })
    await expect(
      repository.fetchReserveIndex({ startAt: 1_000, endAt: 2_000 }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'guide-reserve-index-fetch-failed',
    })
    await expect(repository.triggerReserveUpdate()).resolves.toMatchObject({
      ok: false,
      error: 'guide-reserve-update-failed',
    })
    await expect(
      repository.addProgramReserve({ programId: 10, allowEndLack: true }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'guide-program-reserve-add-failed',
    })
    await expect(repository.deleteReserve(1)).resolves.toMatchObject({
      ok: false,
      error: 'guide-reserve-delete-failed',
    })
    await expect(repository.unlockSkipReserve(1)).resolves.toMatchObject({
      ok: false,
      error: 'guide-reserve-unskip-failed',
    })
    await expect(repository.unlockOverlapReserve(1)).resolves.toMatchObject({
      ok: false,
      error: 'guide-reserve-unoverlap-failed',
    })
  })
})

describe('Guide API action implementation edges', () => {
  function createJsonResponse(body: unknown, ok = true): Response {
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    } as Response
  }

  it('sends ProgramDialog reserve and cancel actions to the guide-owned reserve endpoints', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const repository: GuideApiRepository = createFetchGuideApiRepository({
      basePath: '/api/',
      fetcher: vi.fn(async (url, init) => {
        calls.push({ url: String(url), init })

        return createJsonResponse({ reserveId: 901 })
      }),
    })

    await expect(
      repository.addProgramReserve({
        programId: 100,
        allowEndLack: true,
        encodeOption: {
          mode1: 'H.264',
          isDeleteOriginalAfterEncode: true,
        },
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        reserveId: 901,
      },
    })
    await repository.deleteReserve(901)
    await repository.unlockSkipReserve(902)
    await repository.unlockOverlapReserve(903)

    expect(calls.map((call) => [call.url, call.init?.method])).toStrictEqual([
      ['/api/reserves', 'POST'],
      ['/api/reserves/901', 'DELETE'],
      ['/api/reserves/902/skip', 'DELETE'],
      ['/api/reserves/903/overlap', 'DELETE'],
    ])
    expect(JSON.parse(String(calls[0]?.init?.body))).toStrictEqual({
      programId: 100,
      allowEndLack: true,
      encodeOption: {
        mode1: 'H.264',
        isDeleteOriginalAfterEncode: true,
      },
    })
  })

  it('adapts source reserve list reserveId fields for Guide reserve index refreshes', async () => {
    const repository: GuideApiRepository = createFetchGuideApiRepository({
      basePath: '/api/',
      fetcher: vi.fn(async () =>
        createJsonResponse({
          normal: [{ reserveId: 901, programId: 100 }],
          conflicts: [{ reserveId: 902, programId: 101, ruleId: 12 }],
          skips: [],
          overlaps: [],
        }),
      ),
    })

    await expect(
      repository.fetchReserveIndex({
        startAt: Date.parse('2026-05-05T00:00:00+09:00'),
        endAt: Date.parse('2026-05-06T00:00:00+09:00'),
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        100: {
          type: 'reserve',
          item: { id: 901, programId: 100 },
        },
        101: {
          type: 'conflict',
          item: { id: 902, programId: 101, ruleId: 12 },
        },
      },
    })
  })
})
