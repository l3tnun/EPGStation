import { describe, expect, it, vi } from 'vitest'
import { createFetchOnAirApiRepository } from '@/features/onair/onairApi'
import type { ServerApiFetch } from '@/app/serverApi'

describe('On Air API repository failure paths', () => {
  it('reports fetchOnAir failure when the reserve lists payload is malformed', async () => {
    const fetcher: ServerApiFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchOnAir({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: false,
      error: 'onair-fetch-failed',
      message: '番組情報取得に失敗',
    })
  })

  it('reports fetchOnAir failure when the broadcasting payload is malformed', async () => {
    const fetcher: ServerApiFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ normal: [], conflicts: [], skips: [], overlaps: [] })),
      )
      .mockResolvedValueOnce(new Response('not-json'))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchOnAir({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: false,
      error: 'onair-fetch-failed',
      message: '番組情報取得に失敗',
    })
  })

  it('reports fetchLiveStreams failure when the stream payload is malformed', async () => {
    const fetcher: ServerApiFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('not-json'))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchLiveStreams({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: false,
      error: 'onair-stream-info-fetch-failed',
      message: 'ストリーム情報取得に失敗',
    })
  })

  it('reports fetchLiveStreams failure when the channel names payload is malformed', async () => {
    const fetcher: ServerApiFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(new Response('not-json'))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchLiveStreams({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: false,
      error: 'onair-stream-info-fetch-failed',
      message: 'ストリーム情報取得に失敗',
    })
  })

  it('reports addProgramReserve failure when the server response is malformed', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => new Response('not-json'))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.addProgramReserve({ programId: 1, allowEndLack: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'onair-program-reserve-add-failed',
      message: '予約失敗',
    })
  })

  it('reports deleteReserve/unlockSkipReserve/unlockOverlapReserve failures when the request is not ok', async () => {
    const fetcher: ServerApiFetch = vi.fn(async () => new Response('{}', { status: 500 }))
    const repository = createFetchOnAirApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.deleteReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'onair-reserve-delete-failed',
      message: 'キャンセル失敗',
    })
    await expect(repository.unlockSkipReserve(2)).resolves.toStrictEqual({
      ok: false,
      error: 'onair-reserve-unskip-failed',
      message: '除外解除失敗',
    })
    await expect(repository.unlockOverlapReserve(3)).resolves.toStrictEqual({
      ok: false,
      error: 'onair-reserve-unoverlap-failed',
      message: '重複解除失敗',
    })
  })
})
