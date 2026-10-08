import { describe, expect, it, vi } from 'vitest'
import {
  CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
  CONFIG_DOWNLOAD_FAILURE_MESSAGE,
  VERSION_DOWNLOAD_FAILURE_MESSAGE,
  createFetchServerApiRepository,
} from '@/app/serverApi'
import { detectBrowserUrlSchemePlatform } from '@/shared/settings/urlSchemePlatform'

describe('URL scheme platform detection implementation edges', () => {
  it('matches the legacy platform priority for Android, iOS, iPadOS, macOS, and Windows', () => {
    expect(
      detectBrowserUrlSchemePlatform({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toBe('android')
    expect(
      detectBrowserUrlSchemePlatform({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toBe('ios')
    expect(
      detectBrowserUrlSchemePlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('ios')
    expect(
      detectBrowserUrlSchemePlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe('mac')
    expect(
      detectBrowserUrlSchemePlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 0,
      }),
    ).toBe('win')
  })
})

describe('App Shell API repository implementation edges', () => {
  it('joins the ./api base and repository endpoints exactly once', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ version: '1.2.3' })))
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchVersion()).resolves.toStrictEqual({
      ok: true,
      value: {
        version: '1.2.3',
      },
    })

    expect(fetcher).toHaveBeenCalledWith('./api/version')
  })

  it('maps version and config failures to shell snackbar messages', async () => {
    const repository = createFetchServerApiRepository({
      fetcher: vi.fn(async () => new Response('failure', { status: 500 })),
      basePath: './api',
    })

    await expect(repository.fetchVersion()).resolves.toStrictEqual({
      ok: false,
      error: 'version-fetch-failed',
      message: VERSION_DOWNLOAD_FAILURE_MESSAGE,
    })
    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: false,
      error: 'config-fetch-failed',
      message: CONFIG_DOWNLOAD_FAILURE_MESSAGE,
    })
  })

  it('loads bootstrap channels from the original global startup endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 1, name: 'GR' }])))
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchBootstrapChannels?.()).resolves.toStrictEqual({
      ok: true,
      value: [{ id: 1, name: 'GR' }],
    })
    expect(fetcher).toHaveBeenCalledWith('./api/channels')
  })

  it('maps bootstrap channel failures without throwing', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ channels: [] })))
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchBootstrapChannels?.()).resolves.toStrictEqual({
      ok: false,
      error: 'channels-fetch-failed',
      message: CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
    })
  })

  it('does not abort config fetches at the snackbar timeout boundary', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  isEnableTSLiveStream: false,
                  broadcast: {},
                }),
              ),
            )
          }, 5001)
        }),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    const result = repository.fetchServerConfig()

    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: false,
        enabledBroadcastWaves: [],
      },
    })
    expect(fetcher).toHaveBeenCalledWith('./api/config')
    vi.useRealTimers()
  })
})
