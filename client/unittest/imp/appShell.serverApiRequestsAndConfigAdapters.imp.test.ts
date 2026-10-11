import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'
import { createFetchServerApiRepository } from '@/app/api/fetchServerApiRepository'
import { adaptServerConfig } from '@/app/api/serverConfigAdapters'
import { adaptLiveStreamConfig, filterLiveStreamConfigForIOS } from '@/app/api/streamConfigAdapters'
import {
  CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
  CONFIG_DOWNLOAD_FAILURE_MESSAGE,
  VERSION_DOWNLOAD_FAILURE_MESSAGE,
} from '@/app/api/serverApiTypes'

vi.mock('@/shared/media/mpegtsSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/media/mpegtsSupport')>()),
  detectMpegtsLivePlaybackSupport: vi.fn(() => true),
}))

const noIos = { platform: null, supportsM2tsLl: false }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(detectMpegtsLivePlaybackSupport).mockReturnValue(true)
})

describe('server API repository requests', () => {
  it('drops one trailing slash of the base path before every endpoint', async () => {
    const urls: string[] = []
    const repository = createFetchServerApiRepository({
      basePath: '/api/',
      platform: null,
      supportsM2tsLl: false,
      fetcher: async (url) => {
        urls.push(String(url))

        return new Response(JSON.stringify({ version: '1', ...[] }))
      },
    })

    await repository.fetchVersion()
    await repository.fetchServerConfig()
    await repository.fetchBootstrapChannels?.()

    expect(urls).toStrictEqual(['/api/version', '/api/config', '/api/channels'])
  })

  it('reports each download failure for a failure status with a valid body and for a rejected request', async () => {
    const failing = createFetchServerApiRepository({
      platform: null,
      supportsM2tsLl: false,
      fetcher: async () => new Response(JSON.stringify({ version: '1' }), { status: 500 }),
    })
    const rejecting = createFetchServerApiRepository({
      platform: null,
      supportsM2tsLl: false,
      fetcher: async () => {
        throw new Error('network')
      },
    })

    for (const repository of [failing, rejecting]) {
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
      await expect(repository.fetchBootstrapChannels?.()).resolves.toStrictEqual({
        ok: false,
        error: 'channels-fetch-failed',
        message: CHANNELS_DOWNLOAD_FAILURE_MESSAGE,
      })
    }
  })

  const liveStreamConfig = {
    streamConfig: { live: { ts: { m2ts: [{ name: 'a' }], m2tsll: ['b'], webm: ['c'] } } },
  }
  const fetchConfigWith = (options: Parameters<typeof createFetchServerApiRepository>[0]) =>
    createFetchServerApiRepository({
      fetcher: async () => new Response(JSON.stringify(liveStreamConfig)),
      ...options,
    }).fetchServerConfig()

  it('detects the iOS platform from the navigator and filters the live stream config for it', async () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: '', maxTouchPoints: 0 })

    await expect(fetchConfigWith({})).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { live: { ts: { m2ts: [{ name: 'a' }], m2tsll: ['b'] } } } },
    })
  })

  it('offers M2TS-LL on iOS only when the runtime reports support, and not without a navigator', async () => {
    vi.stubGlobal('navigator', { userAgent: 'x', platform: '', maxTouchPoints: 0 })
    vi.mocked(detectMpegtsLivePlaybackSupport).mockReturnValue(false)
    await expect(fetchConfigWith({ platform: 'ios' })).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { live: { ts: { m2ts: [{ name: 'a' }] } } } },
    })

    vi.mocked(detectMpegtsLivePlaybackSupport).mockReturnValue(true)
    vi.stubGlobal('navigator', undefined)
    await expect(fetchConfigWith({ platform: 'ios' })).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { live: { ts: { m2ts: [{ name: 'a' }] } } } },
    })
    const result = await fetchConfigWith({ platform: 'ios' })
    expect(result.ok && result.value.streamConfig?.live?.ts).not.toHaveProperty('m2tsll')
  })

  it('works without a navigator global', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Reflect.deleteProperty(globalThis, 'navigator')
    try {
      await expect(
        createFetchServerApiRepository({
          fetcher: async () => new Response(JSON.stringify({})),
        }).fetchServerConfig(),
      ).resolves.toMatchObject({ ok: true })
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, 'navigator', descriptor)
      }
    }
  })
})

describe('server config adapter', () => {
  it('adds only the url scheme platforms that have a string value', () => {
    expect(
      adaptServerConfig(
        { urlscheme: { video: { ios: 5 }, download: {}, m2ts: { ios: 'a' } } },
        noIos,
      )?.urlscheme,
    ).toStrictEqual({ m2ts: { ios: 'a' } })
    expect(adaptServerConfig({ urlscheme: {} }, noIos)?.urlscheme).toStrictEqual({})
    expect(
      adaptServerConfig(
        { urlscheme: { video: { mac: 'v' }, download: { win: 'd', android: 'x' } } },
        noIos,
      )?.urlscheme,
    ).toStrictEqual({ video: { mac: 'v' }, download: { win: 'd', android: 'x' } })
  })

  it('marks encode as enabled only by the flag or by at least one encode mode', () => {
    const encodeKeys = (raw: unknown) => {
      const config = adaptServerConfig(raw, noIos)
      return config === null
        ? null
        : { isEncodeEnabled: config.isEncodeEnabled, encodeModes: config.encodeModes }
    }

    expect(encodeKeys({})).toStrictEqual({ isEncodeEnabled: undefined, encodeModes: undefined })
    expect(encodeKeys({ isEnableEncode: false })).toStrictEqual({
      isEncodeEnabled: undefined,
      encodeModes: undefined,
    })
    expect(encodeKeys({ isEnableEncode: true })).toStrictEqual({
      isEncodeEnabled: true,
      encodeModes: undefined,
    })
    expect(encodeKeys({ encodeModes: ['H.264'] })).toStrictEqual({
      isEncodeEnabled: true,
      encodeModes: ['H.264'],
    })
    expect(encodeKeys({ encode: ['VP9', 1] })).toStrictEqual({
      isEncodeEnabled: true,
      encodeModes: ['VP9'],
    })
    expect('isEncodeEnabled' in (adaptServerConfig({}, noIos) ?? {})).toBe(false)
    expect('isEncodeEnabled' in (adaptServerConfig({ encodeModes: [] }, noIos) ?? {})).toBe(false)
  })
})

describe('stream config adapter', () => {
  it('rejects a stream config that is not an object', () => {
    expect(adaptLiveStreamConfig(null)).toBeUndefined()
    expect(adaptLiveStreamConfig({ live: null, recorded: null })).toBeUndefined()
  })

  it('keeps only M2TS entries with a non-empty string name', () => {
    expect(
      adaptLiveStreamConfig({
        live: { ts: { m2ts: [null, 'x', { name: '' }, { name: 5 }, { name: 'ok' }] } },
      }),
    ).toStrictEqual({ live: { ts: { m2ts: [{ name: 'ok' }] } } })
  })

  it('filters an iOS config without adding keys that have no value', () => {
    expect(
      filterLiveStreamConfigForIOS({
        streamConfig: { live: { ts: { m2ts: [{ name: 'a' }] } } },
        supportsM2tsLl: true,
      }),
    ).toStrictEqual({ live: { ts: { m2ts: [{ name: 'a' }] } } })
    expect(
      filterLiveStreamConfigForIOS({
        streamConfig: { recorded: { ts: { hls: ['x'], webm: ['y'] } } },
        supportsM2tsLl: false,
      }),
    ).toStrictEqual({ recorded: { ts: { hls: ['x'] } } })
    expect(
      filterLiveStreamConfigForIOS({
        streamConfig: { recorded: { encoded: { hls: ['x'] } } },
        supportsM2tsLl: false,
      }),
    ).toStrictEqual({ recorded: { encoded: { hls: ['x'] } } })
    expect(
      filterLiveStreamConfigForIOS({
        streamConfig: { recorded: { ts: { webm: ['y'] } } },
        supportsM2tsLl: false,
      }),
    ).toBeUndefined()
  })
})
