import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'

describe('Recorded detail implementation edges', () => {
  it('rejects recorded detail payloads without a numeric id', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({})))
    const repository = createFetchRecordedApiRepository({ fetcher })

    await expect(
      repository.fetchRecordedDetail({ recordedId: 301, isHalfWidth: true }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })
  })

  it('adapts recorded search option source payloads and rule detail keywords', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      switch (String(url)) {
        case '/api/recorded/options':
          return new Response(
            JSON.stringify({
              channels: [{ channelId: 4101, cnt: 3 }],
              genres: [{ genre: 5, cnt: 4 }],
            }),
          )
        case '/api/channels':
          return new Response(
            JSON.stringify([
              {
                id: 4101,
                name: 'Synthetic full channel',
                halfWidthName: 'Synthetic half channel',
              },
            ]),
          )
        case '/api/rules/55':
          return new Response(
            JSON.stringify({
              id: 55,
              isTimeSpecification: false,
              searchOption: { keyword: 'Fetched rule keyword' },
              reserveOption: {},
            }),
          )
        default:
          return new Response(JSON.stringify({}), { status: 404 })
      }
    })
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchRecordedOptions()).resolves.toStrictEqual({
      ok: true,
      value: {
        channels: [
          {
            id: 4101,
            name: 'Synthetic full channel(3)',
            halfWidthName: 'Synthetic half channel(3)',
          },
        ],
        genres: [{ id: 5, name: 'バラエティ(4)' }],
      },
    })
    await expect(repository.fetchRule(55)).resolves.toStrictEqual({
      ok: true,
      value: { id: 55, keyword: 'Fetched rule keyword' },
    })
  })

  it('builds upload options from channel list and static genres without recorded search options', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/channels') {
        return new Response(
          JSON.stringify([{ id: 101, name: 'Synthetic Channel', halfWidthName: 'Synthetic Half' }]),
          { status: 200 },
        )
      }

      return new Response(null, { status: 404 })
    })
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchRecordedUploadOptions?.()).resolves.toStrictEqual({
      ok: true,
      value: {
        channels: [{ id: 101, name: 'Synthetic Channel', halfWidthName: 'Synthetic Half' }],
        genres: expect.arrayContaining([{ id: 0, name: 'ニュース・報道' }]),
      },
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/channels')
  })

  it('uses App Shell bootstrap channels for upload options without issuing a second channels request', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })
    const primeChannelIndex = (
      repository as unknown as {
        primeChannelIndex?: (channels: unknown) => void
      }
    ).primeChannelIndex

    expect(typeof primeChannelIndex).toBe('function')
    primeChannelIndex?.([{ id: 101, name: 'Bootstrap Channel', halfWidthName: 'Bootstrap Half' }])

    await expect(repository.fetchRecordedUploadOptions?.()).resolves.toStrictEqual({
      ok: true,
      value: {
        channels: [{ id: 101, name: 'Bootstrap Channel', halfWidthName: 'Bootstrap Half' }],
        genres: expect.arrayContaining([{ id: 0, name: 'ニュース・報道' }]),
      },
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
