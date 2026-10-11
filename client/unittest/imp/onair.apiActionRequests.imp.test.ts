import { describe, expect, it } from 'vitest'
import { createFetchOnAirApiRepository } from '@/features/onair/onairApi'

describe('On-air API action requests', () => {
  it('sends the reserve add request as JSON and reports the created reserve', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const repository = createFetchOnAirApiRepository({
      basePath: '/api/',
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init })

        return new Response(JSON.stringify({ reserveId: 12 }))
      },
    })

    await expect(
      repository.addProgramReserve({ programId: 3, allowEndLack: true }),
    ).resolves.toStrictEqual({ ok: true, value: { reserveId: 12 } })

    expect(calls[0]?.url).toBe('/api/reserves')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toStrictEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0]?.init?.body))).toStrictEqual({
      programId: 3,
      allowEndLack: true,
    })
  })

  it('reports success without a value for delete, skip release and overlap release', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = []
    const repository = createFetchOnAirApiRepository({
      basePath: '/api',
      fetcher: async (url, init) => {
        calls.push({ url: String(url), method: init?.method })

        return new Response(null, { status: 200 })
      },
    })

    await expect(repository.deleteReserve(1)).resolves.toStrictEqual({ ok: true, value: undefined })
    await expect(repository.unlockSkipReserve(2)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.unlockOverlapReserve(3)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    expect(calls).toStrictEqual([
      { url: '/api/reserves/1', method: 'DELETE' },
      { url: '/api/reserves/2/skip', method: 'DELETE' },
      { url: '/api/reserves/3/overlap', method: 'DELETE' },
    ])
  })
})
