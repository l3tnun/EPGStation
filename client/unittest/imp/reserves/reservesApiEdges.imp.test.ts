import { describe, expect, it, vi } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'

describe('Reserves API network and adapter edges not covered by happy paths', () => {
  const request = {
    type: 'normal' as const,
    isHalfWidth: true,
    limit: 24,
    offset: 0,
    page: 1,
    routeType: 'normal' as const,
  }

  it('[AC 1.8] treats a non-ok GET /reserves response as fetch failure', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })
  })

  it('[AC 1.8] treats a rejected GET /reserves fetch as fetch failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down')
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchReserves(request)).resolves.toStrictEqual({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })
  })

  it('[AC 4.13] treats a malformed existing-reserve response as manual reserve fetch failure', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({})))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchManualReserve({ reserveId: 10, isHalfWidth: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-fetch-failed',
      message: '予約情報取得に失敗',
    })
  })

  it('[AC 4.13] treats a malformed program response as manual program fetch failure', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (href === '/api/channels') {
        return new Response(JSON.stringify([]))
      }

      return new Response(JSON.stringify({ id: 20 }))
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchManualProgram({ programId: 20, isHalfWidth: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-program-fetch-failed',
      message: '番組情報取得に失敗',
    })
  })

  it('[AC 4.12] keeps a program-supplied channelName as-is without consulting the channel index', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (href === '/api/channels') {
        return new Response(JSON.stringify([{ id: 1, name: 'Index channel' }]))
      }

      return new Response(
        JSON.stringify({
          id: 20,
          name: 'Program',
          channelId: 1,
          channelName: 'Direct program channel',
          startAt: 1_000,
          endAt: 2_000,
          description: 'description',
          extended: 'extended',
          genres: ['genre text', 42],
          genre1: 1,
          subGenre1: 2,
          genre2: 3,
          subGenre2: 4,
          genre3: 5,
          subGenre3: 6,
          isFree: false,
          videoComponentType: 1,
          audioComponentType: 2,
          audioSamplingRate: 3,
        }),
      )
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchManualProgram({ programId: 20, isHalfWidth: true }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        id: 20,
        name: 'Program',
        channelId: 1,
        channelName: 'Direct program channel',
        startAt: 1_000,
        endAt: 2_000,
        description: 'description',
        extended: 'extended',
        genres: ['genre text'],
        genre1: 1,
        subGenre1: 2,
        genre2: 3,
        subGenre2: 4,
        genre3: 5,
        subGenre3: 6,
        isFree: false,
        videoComponentType: 1,
        audioComponentType: 2,
        audioSamplingRate: 3,
      },
    })
  })

  it('[AC 4.12] returns only the required fields when every optional program field is absent', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const href = typeof url === 'string' ? url : url.toString()
      if (href === '/api/channels') {
        return new Response(JSON.stringify([]))
      }

      return new Response(
        JSON.stringify({
          id: 21,
          name: 'Bare program',
          channelId: 2,
          startAt: 1_000,
          endAt: 2_000,
        }),
      )
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchManualProgram({ programId: 21, isHalfWidth: true }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { id: 21, name: 'Bare program', channelId: 2, startAt: 1_000, endAt: 2_000 },
    })
  })

  it('[AC 4.9] rejects updateManualReserve calls for a non-integer reserveId before any fetch', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.updateManualReserve(Number.NaN, { allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('[AC 3.3] treats a non-ok DELETE /reserves/:reserveId response as delete failure', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.deleteReserve(10)).resolves.toStrictEqual({
      ok: false,
      error: 'reserve-delete-failed',
      message: '予約削除に失敗',
    })
  })

  it('[AC 3.3] treats a rejected DELETE /reserves/:reserveId fetch as delete failure', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down')
    })
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.deleteReserve(10)).resolves.toStrictEqual({
      ok: false,
      error: 'reserve-delete-failed',
      message: '予約削除に失敗',
    })
  })

  it('[AC 4.8] treats a non-ok POST /reserves response as add failure', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 500 }))
    const repository = createFetchReservesApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.addManualReserve({ allowEndLack: true, programId: 100 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'manual-reserve-add-failed',
      message: '予約の追加に失敗しました。',
    })
  })
})
