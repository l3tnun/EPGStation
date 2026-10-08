import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'

describe('Reserves API action implementation edges', () => {
  const request = {
    type: 'normal' as const,
    isHalfWidth: true,
    limit: 24,
    offset: 0,
    page: 1,
    routeType: 'normal' as const,
  }

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'rejects invalid delete reserve id %s before fetch',
    async (reserveId) => {
      const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
      const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

      await expect(repository.deleteReserve(reserveId)).resolves.toStrictEqual({
        ok: false,
        error: 'reserve-delete-failed',
        message: '予約削除に失敗',
      })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it('adapts complete reserve and manual program payloads with channel hydration', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/channels') {
        return new Response(JSON.stringify([{ id: 1, halfWidthName: 'Half Channel' }]))
      }
      if (href.startsWith('/api/reserves?')) {
        return new Response(
          JSON.stringify({
            total: 1,
            reserves: [
              {
                reserveId: 10,
                programId: 20,
                name: 'Reserve',
                channelId: 1,
                channelType: 'GR',
                startAt: 1_000,
                endAt: 2_000,
                description: 'description',
                extended: 'extended',
                ruleId: 30,
                genre1: 7,
                subGenre1: 1,
                genre2: 8,
                subGenre2: 2,
                genre3: 9,
                subGenre3: 3,
                isConflict: true,
                isSkip: false,
                isOverlap: true,
                isTimeSpecified: false,
                allowEndLack: true,
                parentDirectoryName: 'parent',
                directory: 'dir',
                recordedFormat: 'mp4',
                encodeMode1: 'mode1',
                encodeParentDirectoryName1: 'p1',
                encodeDirectory1: 'd1',
                encodeMode2: 'mode2',
                encodeParentDirectoryName2: 'p2',
                encodeDirectory2: 'd2',
                encodeMode3: 'mode3',
                encodeParentDirectoryName3: 'p3',
                encodeDirectory3: 'd3',
                isDeleteOriginalAfterEncode: true,
                genres: ['genre text', 1],
              },
            ],
          }),
        )
      }
      if (href.startsWith('/api/reserves/10?')) {
        return new Response(JSON.stringify({ id: 10, name: 'Reserve' }))
      }
      if (href.startsWith('/api/schedules/detail/20?')) {
        return new Response(
          JSON.stringify({
            id: 20,
            name: 'Program',
            channelId: 1,
            startAt: 1_000,
            endAt: 2_000,
            description: 'description',
            extended: 'extended',
            genre1: 7,
            subGenre1: 1,
            genre2: 8,
            subGenre2: 2,
            genre3: 9,
            subGenre3: 3,
            isFree: true,
            videoComponentType: 1,
            audioComponentType: 2,
            audioSamplingRate: 3,
          }),
        )
      }
      if (href === '/api/reserves' && init?.method === 'POST') {
        return new Response(JSON.stringify({ reserveId: 99 }))
      }
      return new Response(null, { status: 204 })
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.fetchReserves(request)).resolves.toMatchObject({
      ok: true,
      value: {
        total: 1,
        reserves: [
          {
            id: 10,
            programId: 20,
            name: 'Reserve',
            channelId: 1,
            channelName: 'Half Channel',
            channelType: 'GR',
            startAt: 1_000,
            endAt: 2_000,
            description: 'description',
            extended: 'extended',
            ruleId: 30,
            genres: ['genre text'],
          },
        ],
      },
    })
    await expect(
      repository.fetchManualReserve({ reserveId: 10, isHalfWidth: true }),
    ).resolves.toEqual({
      ok: true,
      value: { id: 10, name: 'Reserve' },
    })
    await expect(
      repository.fetchManualProgram({ programId: 20, isHalfWidth: true }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: 20,
        name: 'Program',
        channelId: 1,
        channelName: 'Half Channel',
        isFree: true,
      },
    })
    await expect(repository.addManualReserve({ allowEndLack: true })).resolves.toEqual({
      ok: true,
      value: { reserveId: 99 },
    })
    await expect(repository.updateManualReserve(10, { allowEndLack: true })).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.deleteReserve(10)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.unlockSkipReserve(10)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.unlockOverlapReserve(10)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.updateReserves()).resolves.toEqual({ ok: true, value: undefined })
  })

  it('returns typed action failures when reserve endpoints reject', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.unlockSkipReserve(10)).resolves.toMatchObject({
      ok: false,
      error: 'unlock-skip-failed',
    })
    await expect(repository.unlockOverlapReserve(10)).resolves.toMatchObject({
      ok: false,
      error: 'unlock-overlap-failed',
    })
    await expect(repository.updateReserves()).resolves.toMatchObject({
      ok: false,
      error: 'reserves-update-failed',
    })
  })
})
