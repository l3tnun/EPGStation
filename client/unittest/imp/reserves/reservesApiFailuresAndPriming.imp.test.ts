import { describe, expect, it } from 'vitest'
import { createFetchReservesApiRepository } from '@/features/reserves/reservesApi'

describe('Reserves API release failures', () => {
  it('reports the skip release and overlap release failures with their own messages', async () => {
    const repository = createFetchReservesApiRepository({
      fetcher: async () => new Response(null, { status: 500 }),
    })

    await expect(repository.unlockSkipReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'unlock-skip-failed',
      message: '除外解除失敗',
    })
    await expect(repository.unlockOverlapReserve(1)).resolves.toStrictEqual({
      ok: false,
      error: 'unlock-overlap-failed',
      message: '重複解除失敗',
    })
  })
})

describe('Reserves API channel index priming', () => {
  it('names the manual program channel from the primed channel list without requesting it', async () => {
    const urls: string[] = []
    const repository = createFetchReservesApiRepository({
      basePath: '/api',
      fetcher: async (input) => {
        urls.push(String(input))

        return new Response(
          JSON.stringify({
            id: 5,
            channelId: 7,
            name: 'program',
            startAt: 1_000,
            endAt: 2_000,
          }),
        )
      },
    })

    repository.primeChannelIndex?.(Promise.resolve([{ id: 7, name: 'Primed channel' }]))
    const result = await repository.fetchManualProgram({ programId: 5, isHalfWidth: false })

    expect(urls.some((url) => url.includes('/channels'))).toBe(false)
    expect(result).toMatchObject({
      ok: true,
      value: { channelId: 7, channelName: 'Primed channel' },
    })
  })
})
