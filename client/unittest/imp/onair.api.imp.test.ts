import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchOnAirApiRepository } from '@/features/onair/onairApi'

describe('On Air API implementation edges', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches reserve lists and broadcasting schedules through the expected endpoints', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-05-05T09:00:00+09:00'))
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          normal: [{ reserveId: 1, programId: 10 }],
          conflicts: [],
          skips: [],
          overlaps: [],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            channel: { id: 1, name: 'Synthetic GR', channelType: 'GR' },
            programs: [
              {
                id: 10,
                name: 'Synthetic program',
                startAt: 1000,
                endAt: 2000,
                videoComponentType: 0xb3,
                audioComponentType: 0x03,
                audioSamplingRate: 48000,
                isFree: true,
              },
            ],
          },
        ],
      } as Response)
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchOnAir({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: true,
      value: {
        reserveIndex: {
          10: {
            type: 'reserve',
            item: { reserveId: 1, programId: 10 },
          },
        },
        schedules: [
          {
            channel: { id: 1, name: 'Synthetic GR', channelType: 'GR' },
            programs: [
              {
                id: 10,
                name: 'Synthetic program',
                startAt: 1000,
                endAt: 2000,
                videoComponentType: 0xb3,
                audioComponentType: 0x03,
                audioSamplingRate: 48000,
                isFree: true,
              },
            ],
          },
        ],
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/reserves/lists?startAt=1777939200000&endAt=1777942800000',
    )
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/schedules/broadcasting?isHalfWidth=true')
  })

  it('fetches live stream info with channel names through the On Air repository', async () => {
    const fetcher = vi.fn(async (url) => {
      if (String(url).includes('/channels')) {
        return new Response(
          JSON.stringify([
            {
              id: 10,
              name: 'Synthetic Channel',
              halfWidthName: 'Synthetic Half Channel',
              type: 1,
            },
          ]),
        )
      }

      return new Response(
        JSON.stringify({
          items: [
            {
              channelId: 10,
              mode: 2,
              type: 'm2tsll',
              name: 'Synthetic Live',
              description: 'Synthetic live description',
              startAt: 1000,
              endAt: 2000,
            },
          ],
        }),
      )
    })
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.fetchLiveStreams({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: true,
      value: {
        items: [
          {
            channelId: 10,
            channelName: 'Synthetic Half Channel',
            mode: 2,
            type: 'm2tsll',
            name: 'Synthetic Live',
            description: 'Synthetic live description',
            startAt: 1000,
            endAt: 2000,
          },
        ],
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/streams?isHalfWidth=true')
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/channels')
  })

  it('sends ProgramDialog reserve actions through the On Air repository with Guide endpoint parity', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const repository = createFetchOnAirApiRepository({
      basePath: '/api/',
      fetcher: vi.fn(async (url, init) => {
        calls.push({ url: String(url), init })

        return {
          ok: true,
          status: 200,
          json: async () => ({ reserveId: 901 }),
        } as Response
      }),
    }) as ReturnType<typeof createFetchOnAirApiRepository> & {
      addProgramReserve: (payload: {
        programId: number
        allowEndLack: true
        encodeOption?: {
          mode1: string
          isDeleteOriginalAfterEncode: boolean
        }
      }) => Promise<unknown>
      deleteReserve: (reserveId: number) => Promise<unknown>
      unlockSkipReserve: (reserveId: number) => Promise<unknown>
      unlockOverlapReserve: (reserveId: number) => Promise<unknown>
    }

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
})
