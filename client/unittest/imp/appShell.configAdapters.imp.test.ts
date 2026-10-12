import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchServerApiRepository } from '@/app/serverApi'

describe('App Shell API repository implementation edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adapts server config flags to the navigation config contract', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableTSLiveStream: true,
            broadcast: {
              GR: true,
              BS: false,
              CS: true,
              SKY: false,
            },
            socketIOPort: 1234,
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: ['GR', 'CS'],
        socketIOPort: 1234,
      },
    })
  })

  it('appends BS4K last in enabledBroadcastWaves when server config marks it enabled', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableTSLiveStream: true,
            broadcast: {
              GR: true,
              BS: true,
              CS: true,
              SKY: true,
              BS4K: true,
            },
            socketIOPort: 1234,
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
        socketIOPort: 1234,
      },
    })
  })

  it('adapts encode modes and recorded directories from server config using string-only lists', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableEncode: true,
            encode: ['default-mode', 100, 'mobile-mode'],
            recorded: ['archive-root', null, 'backup-root', { path: 'ignored-root' }],
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
    })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: false,
        enabledBroadcastWaves: [],
        isEncodeEnabled: true,
        encodeModes: ['default-mode', 'mobile-mode'],
        recordedDirectories: ['archive-root', 'backup-root'],
      },
    })
  })

  it('adapts live stream config and m2ts url scheme without dropping video and download schemes', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableTSLiveStream: true,
            streamConfig: {
              live: {
                ts: {
                  m2ts: [{ name: 'm2ts-default' }, { name: 100 }],
                  m2tsll: ['ll-low', null],
                  webm: ['webm-low'],
                  mp4: ['mp4-low'],
                  hls: ['hls-low'],
                },
              },
              recorded: {
                ts: {
                  webm: ['ts-webm', null],
                  hls: ['ts-hls'],
                },
                encoded: {
                  mp4: ['encoded-mp4'],
                  hls: ['encoded-hls'],
                },
              },
            },
            urlscheme: {
              video: { ios: 'video-ios' },
              download: { android: 'download-android' },
              m2ts: { ios: 'm2ts-ios', android: 'm2ts-android', mac: 'm2ts-mac', win: 'm2ts-win' },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: [],
        streamConfig: {
          live: {
            ts: {
              m2ts: [{ name: 'm2ts-default' }],
              m2tsll: ['ll-low'],
              webm: ['webm-low'],
              mp4: ['mp4-low'],
              hls: ['hls-low'],
            },
          },
          recorded: {
            ts: {
              webm: ['ts-webm'],
              hls: ['ts-hls'],
            },
            encoded: {
              mp4: ['encoded-mp4'],
              hls: ['encoded-hls'],
            },
          },
        },
        urlscheme: {
          video: { ios: 'video-ios' },
          download: { android: 'download-android' },
          m2ts: {
            ios: 'm2ts-ios',
            android: 'm2ts-android',
            mac: 'm2ts-mac',
            win: 'm2ts-win',
          },
        },
      },
    })
  })

  it('filters iOS-incompatible stream config like the original server config model', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableTSLiveStream: true,
            streamConfig: {
              live: {
                ts: {
                  m2ts: [{ name: 'm2ts-default' }],
                  m2tsll: ['ll-low'],
                  webm: ['webm-low'],
                  mp4: ['mp4-low'],
                  hls: ['hls-low'],
                },
              },
              recorded: {
                ts: {
                  webm: ['ts-webm'],
                  mp4: ['ts-mp4'],
                  hls: ['ts-hls'],
                },
                encoded: {
                  webm: ['encoded-webm'],
                  mp4: ['encoded-mp4'],
                  hls: ['encoded-hls'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
      platform: 'ios',
      supportsM2tsLl: false,
    })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: [],
        streamConfig: {
          live: {
            ts: {
              m2ts: [{ name: 'm2ts-default' }],
              hls: ['hls-low'],
            },
          },
          recorded: {
            ts: {
              hls: ['ts-hls'],
            },
            encoded: {
              hls: ['encoded-hls'],
            },
          },
        },
      },
    })
  })

  it('reports a version-fetch failure when the version payload has no string version', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ version: 123 })))
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchVersion()).resolves.toMatchObject({ ok: false })
  })

  it('keeps kodiHosts only when at least one string entry survives filtering', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kodiHosts: ['kodi-1', 100, 'kodi-2', null],
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { kodiHosts: ['kodi-1', 'kodi-2'] },
    })
  })

  it('drops kodiHosts entirely when every entry fails the string filter', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kodiHosts: [100, null, { host: 'ignored' }],
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    const result = await repository.fetchServerConfig()

    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.value).not.toHaveProperty('kodiHosts')
  })

  it('drops a non-record urlscheme platform entry instead of throwing', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            urlscheme: {
              video: 'not-a-record',
              download: {},
              m2ts: { ios: 'm2ts-ios' },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: {
        urlscheme: {
          m2ts: { ios: 'm2ts-ios' },
        },
      },
    })
  })

  it('prefers the encodeModes field over the legacy encode field when both are present', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            encodeModes: ['preferred-mode'],
            encode: ['ignored-legacy-mode'],
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { encodeModes: ['preferred-mode'] },
    })
  })

  it('keeps a urlscheme with only a video entry and no m2ts entry', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            urlscheme: { video: { ios: 'video-ios' } },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    const result = await repository.fetchServerConfig()

    expect(result).toMatchObject({
      ok: true,
      value: { urlscheme: { video: { ios: 'video-ios' } } },
    })
    expect(result.ok && result.value.urlscheme).not.toHaveProperty('m2ts')
  })

  it('marks encode enabled from the encode flag alone even without encode modes', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ isEnableEncode: true })))
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { isEncodeEnabled: true },
    })
  })

  it('keeps only the recorded ts stream file config when encoded is absent', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              recorded: {
                ts: { hls: ['ts-hls'] },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { recorded: { ts: { hls: ['ts-hls'] } } } },
    })
  })

  it('keeps only the recorded encoded stream file config when ts is absent', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              recorded: {
                encoded: { hls: ['encoded-hls'] },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { recorded: { encoded: { hls: ['encoded-hls'] } } } },
    })
  })

  it('keeps only the iOS-filtered recorded ts config when encoded is absent', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              recorded: {
                ts: { hls: ['ts-hls'] },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
      platform: 'ios',
      supportsM2tsLl: false,
    })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { recorded: { ts: { hls: ['ts-hls'] } } } },
    })
  })

  it('keeps only the iOS-filtered recorded encoded config when ts is absent', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              recorded: {
                encoded: { hls: ['encoded-hls'] },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
      platform: 'ios',
      supportsM2tsLl: false,
    })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: { streamConfig: { recorded: { encoded: { hls: ['encoded-hls'] } } } },
    })
  })

  it('drops an empty stream config entirely when nothing adapts to a known field', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              unrelatedField: true,
              live: { ts: { m2ts: [{ notAName: 'oops' }], m2tsll: [''], hls: [123] } },
              recorded: { ts: 'not-a-record', encoded: {} },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    const result = await repository.fetchServerConfig()

    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.value).not.toHaveProperty('streamConfig')
  })

  it('drops the recorded stream file config for iOS when only WebM and MP4 lists are present', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              recorded: {
                ts: {
                  webm: ['ts-webm'],
                  mp4: ['ts-mp4'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
      platform: 'ios',
      supportsM2tsLl: false,
    })

    const result = await repository.fetchServerConfig()

    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.value).not.toHaveProperty('streamConfig')
  })

  it('keeps live M2TS-LL only when the runtime reports MSE live playback support, while still removing WebM and MP4 on iOS', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            isEnableTSLiveStream: true,
            streamConfig: {
              live: {
                ts: {
                  m2tsll: ['ll-low'],
                  webm: ['webm-low'],
                  mp4: ['mp4-low'],
                  hls: ['hls-low'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({
      fetcher,
      basePath: './api',
      platform: 'ios',
      supportsM2tsLl: true,
    })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: [],
        streamConfig: {
          live: {
            ts: {
              m2tsll: ['ll-low'],
              hls: ['hls-low'],
            },
          },
        },
      },
    })
  })

  it('offers live M2TS-LL by default on an iPhone UA when only ManagedMediaSource reports support (feature detection, not a device check)', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal(
      'ManagedMediaSource',
      class {
        static isTypeSupported() {
          return true
        }
      },
    )

    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              live: {
                ts: {
                  m2tsll: ['ll-low'],
                  webm: ['webm-low'],
                  mp4: ['mp4-low'],
                  hls: ['hls-low'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: {
        streamConfig: {
          live: {
            ts: {
              m2tsll: ['ll-low'],
              hls: ['hls-low'],
            },
          },
        },
      },
    })
  })

  it('drops live M2TS-LL by default on an iPad UA when neither MediaSource nor ManagedMediaSource report support', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPad',
      maxTouchPoints: 5,
    })
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', undefined)

    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              live: {
                ts: {
                  m2tsll: ['ll-low'],
                  hls: ['hls-low'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    const result = await repository.fetchServerConfig()

    expect(result).toMatchObject({ ok: true })
    const streamConfig = result.ok ? result.value.streamConfig : undefined
    expect(streamConfig?.live?.ts).not.toHaveProperty('m2tsll')
    expect(streamConfig?.live?.ts?.hls).toStrictEqual(['hls-low'])
  })

  it('leaves live M2TS-LL untouched on non-iOS platforms regardless of MSE feature support (unchanged from today)', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    })
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', undefined)

    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            streamConfig: {
              live: {
                ts: {
                  m2tsll: ['ll-low'],
                  webm: ['webm-low'],
                  hls: ['hls-low'],
                },
              },
            },
          }),
        ),
    )
    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toMatchObject({
      ok: true,
      value: {
        streamConfig: {
          live: {
            ts: {
              m2tsll: ['ll-low'],
              webm: ['webm-low'],
              hls: ['hls-low'],
            },
          },
        },
      },
    })
  })
})
