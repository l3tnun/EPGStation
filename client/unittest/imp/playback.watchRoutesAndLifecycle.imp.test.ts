import { describe, expect, it, vi } from 'vitest'
import { DefaultSettingsFactory } from '@/shared/settings'
import {
  createFetchHlsLifecycleRepository,
  rebuildDirectStreamUrlForSeek,
  resolvePlaybackLifecycleMode,
} from '@/features/video/playback/playbackLifecycle'
import {
  resolveLiveWatchRoute,
  resolveRecordedStreamingWatchRoute,
  resolveRecordedWatchRoute,
} from '@/features/video/playback/playbackRoutes'
import {
  readVideoPlayerSetting,
  resolveSubtitleRendererContract,
  saveVideoPlayerSetting,
} from '@/features/video/playback/playbackSettings'
import {
  createNativeTextTrackSubtitleAdapter,
  pushMpegtsPrivateData,
} from '@/features/video/playback/playbackSubtitle'
import { RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY } from '@/features/recorded/requests/constants'
import {
  buildVideoDownloadUrl,
  buildVideoPlaylistUrl,
  buildVideoUrlSchemeHandoffUrl,
  buildRecordedPlaybackHandoffTarget,
} from '@/features/recorded/requests/videoHandoff'
import {
  buildRecordedStreamingRoute,
  normalizeRecordedSelectStreamSetting,
  readRecordedSelectStreamSetting,
  resolveRecordedStreamCandidates,
  writeRecordedSelectStreamSetting,
} from '@/features/recorded/requests/streamSelect'

const ids = (n: number) => Array.from({ length: n }, (_, index) => `m${index}`)
const liveConfig = {
  live: {
    ts: { m2ts: ids(1), m2tsll: ids(2), webm: ids(3), mp4: ids(4), hls: ids(5) },
  },
} as never

describe('live watch route', () => {
  it.each([
    ['m2ts', 1],
    ['m2tsll', 2],
    ['webm', 3],
    ['mp4', 4],
    ['hls', 5],
  ])('accepts a %s mode only below the number of configured modes (%i)', (type, count) => {
    const search = (mode: number) => `?type=${type}&channel=3&mode=${mode}`

    expect(
      resolveLiveWatchRoute({ search: search(count - 1), streamConfig: liveConfig }),
    ).toStrictEqual({
      ok: true,
      value: { kind: 'live', channelId: 3, mode: count - 1, streamingType: type },
    })
    expect(
      resolveLiveWatchRoute({ search: search(count), streamConfig: liveConfig }),
    ).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
  })

  it('treats a missing mode list as zero modes instead of failing', () => {
    for (const type of ['m2ts', 'm2tsll', 'webm', 'mp4', 'hls']) {
      for (const streamConfig of [undefined, {}, { live: {} }, { live: { ts: {} } }] as never[]) {
        expect(
          resolveLiveWatchRoute({ search: `?type=${type}&channel=3&mode=0`, streamConfig }),
        ).toStrictEqual({ ok: false, message: '再生条件が不正です' })
      }
    }
  })

  it('is pending only when type, channel and mode are all missing', () => {
    const pending = { ok: false, reason: 'pending-config', message: null }

    expect(resolveLiveWatchRoute({ search: '' })).toStrictEqual(pending)
    for (const search of ['?type=hls', '?channel=1', '?mode=1']) {
      expect(resolveLiveWatchRoute({ search, streamConfig: liveConfig })).toStrictEqual({
        ok: false,
        message: '再生条件が不正です',
      })
    }
  })

  it('rejects a missing mode or channel even when the other parts are valid', () => {
    expect(
      resolveLiveWatchRoute({ search: '?type=hls&channel=1', streamConfig: liveConfig }).ok,
    ).toBe(false)
    expect(resolveLiveWatchRoute({ search: '?type=hls&mode=0', streamConfig: liveConfig }).ok).toBe(
      false,
    )
  })

  it.each(['01', '1e2', '+1', ' 1', '1.0', '-1', '1a', 'a1'])(
    'rejects %s as a channel number',
    (channel) => {
      expect(
        resolveLiveWatchRoute({
          search: `?type=hls&channel=${encodeURIComponent(channel)}&mode=0`,
          streamConfig: liveConfig,
        }).ok,
      ).toBe(false)
    },
  )

  it('skips the mode count check while the server config is loading', () => {
    expect(
      resolveLiveWatchRoute({ search: '?type=hls&channel=1&mode=9', isConfigLoaded: false }).ok,
    ).toBe(true)
  })
})

describe('recorded streaming watch route', () => {
  const recorded = {
    recorded: {
      ts: { hls: ids(2), webm: ids(3), mp4: ids(4) },
      encoded: { hls: ids(1), webm: ids(1), mp4: ids(1) },
    },
  } as never
  const search = (type: string, fileType: string, mode: number) =>
    `?streamingType=${type}&fileType=${fileType}&mode=${mode}&recordedId=9`

  it('accepts a mode below the number of configured modes and defaults to a loaded config', () => {
    const route = resolveRecordedStreamingWatchRoute({
      videoFileId: '5',
      search: search('mp4', 'ts', 3),
      streamConfig: recorded,
    })

    expect(route).toStrictEqual({
      ok: true,
      value: {
        kind: 'recorded-streaming',
        videoFileId: 5,
        fileType: 'ts',
        mode: 3,
        streamingType: 'mp4',
        recordedId: 9,
        shouldRenderInfoCard: true,
      },
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '5',
        search: search('mp4', 'ts', 4),
        streamConfig: recorded,
      }).ok,
    ).toBe(false)
  })

  it('counts the modes of each streaming type and file type separately', () => {
    for (const [type, count] of [
      ['hls', 2],
      ['webm', 3],
      ['mp4', 4],
    ] as const) {
      expect(
        resolveRecordedStreamingWatchRoute({
          videoFileId: '1',
          search: search(type, 'ts', count - 1),
          streamConfig: recorded,
        }).ok,
      ).toBe(true)
      expect(
        resolveRecordedStreamingWatchRoute({
          videoFileId: '1',
          search: search(type, 'ts', count),
          streamConfig: recorded,
        }).ok,
      ).toBe(false)
      expect(
        resolveRecordedStreamingWatchRoute({
          videoFileId: '1',
          search: search(type, 'encoded', 1),
          streamConfig: recorded,
        }).ok,
      ).toBe(false)
    }
  })

  it('treats a missing mode list as zero modes instead of failing', () => {
    for (const type of ['hls', 'webm', 'mp4']) {
      for (const streamConfig of [
        undefined,
        {},
        { recorded: {} },
        { recorded: { ts: {} } },
      ] as never[]) {
        expect(
          resolveRecordedStreamingWatchRoute({
            videoFileId: '1',
            search: search(type, 'ts', 0),
            streamConfig,
          }),
        ).toStrictEqual({ ok: false, message: 'ストリーム再生条件が不正です' })
      }
    }
  })

  it('rejects live-only streaming types, unknown file types and a missing video id', () => {
    for (const type of ['m2ts', 'x']) {
      expect(
        resolveRecordedStreamingWatchRoute({
          videoFileId: '1',
          search: search(type, 'ts', 0),
          streamConfig: recorded,
        }).ok,
      ).toBe(false)
    }
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '1',
        search: search('hls', 'x', 0),
        streamConfig: recorded,
      }).ok,
    ).toBe(false)
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: undefined,
        search: search('hls', 'ts', 0),
        streamConfig: recorded,
      }).ok,
    ).toBe(false)
  })

  it('judges an unknown file type before waiting for the config', () => {
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '1',
        search: search('hls', 'x', 0),
        isConfigLoaded: false,
      }),
    ).toStrictEqual({ ok: false, message: 'ストリーム再生条件が不正です' })
  })

  it('waits for the config before judging the mode', () => {
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '1',
        search: search('hls', 'ts', 9),
        isConfigLoaded: false,
      }),
    ).toStrictEqual({ ok: false, reason: 'pending-config', message: null })
  })
})

describe('playback lifecycle helpers', () => {
  it('uses the HLS API for an hls streaming type even when the source is not an HLS stream', () => {
    expect(resolvePlaybackLifecycleMode({ sourceKind: 'direct-video', streamingType: 'hls' })).toBe(
      'hls-api',
    )
    expect(resolvePlaybackLifecycleMode({ sourceKind: 'hls-stream' })).toBe('hls-api')
    expect(resolvePlaybackLifecycleMode({ sourceKind: 'direct-video', streamingType: 'mp4' })).toBe(
      'direct-video',
    )
    expect(
      resolvePlaybackLifecycleMode({
        sourceKind: 'direct-response' as never,
        streamingType: 'mp4',
      }),
    ).toBe('direct-response')
  })

  it('keeps only origin, path and query of an absolute URL when rebuilding for a seek', () => {
    expect(rebuildDirectStreamUrlForSeek('http://host:8080/a/b?x=1', 5)).toBe(
      'http://host:8080/a/b?x=1&ss=5',
    )
    expect(rebuildDirectStreamUrlForSeek('https://host/p', 7)).toBe('https://host/p?ss=7')
    expect(rebuildDirectStreamUrlForSeek('HTTP://Host:80/a%20b?x=1', 5)).toBe(
      'http://host/a%20b?x=1&ss=5',
    )
    expect(rebuildDirectStreamUrlForSeek('/api/videos/1?isDownload=true', 5)).toBe(
      '/api/videos/1?isDownload=true&ss=5',
    )
    expect(rebuildDirectStreamUrlForSeek('/api/go?to=http://other/p', 5)).toBe(
      '/api/go?to=http%3A%2F%2Fother%2Fp&ss=5',
    )
  })
})

describe('HLS lifecycle repository requests', () => {
  function repository(response: { ok: boolean; body?: unknown }) {
    const fetcher = vi.fn(
      async () => ({ ok: response.ok, json: async () => response.body }) as Response,
    )
    return {
      fetcher,
      repo: createFetchHlsLifecycleRepository({
        streamStartUrl: '/base/streams/1/hls',
        readinessUrl: '/base/streams',
        fetcher: fetcher as never,
      }),
    }
  }

  it('passes the abort signal to the start and readiness requests', async () => {
    const signal = new AbortController().signal
    const start = repository({ ok: true, body: { streamId: 4 } })
    await start.repo.start(signal)
    expect(start.fetcher).toHaveBeenCalledWith('/base/streams/1/hls', { signal })

    const list = repository({ ok: true, body: [] })
    await list.repo.fetchStreams(signal)
    expect(list.fetcher).toHaveBeenCalledWith('/base/streams', { signal })
  })

  it('sends keep as PUT and stop as DELETE and succeeds on an ok response', async () => {
    const { fetcher, repo } = repository({ ok: true })

    await expect(repo.keep(4)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenLastCalledWith('/base/streams/4/keep', { method: 'PUT' })
    await expect(repo.stop(4)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenLastCalledWith('/base/streams/4', { method: 'DELETE' })
  })

  it('fails keep and stop on a failed response', async () => {
    const { repo } = repository({ ok: false })

    await expect(repo.keep(4)).rejects.toThrow('HLS stream keep failed')
    await expect(repo.stop(4)).rejects.toThrow('HLS stream stop failed')
  })
})

describe('video player setting storage', () => {
  const storageOf = (value: string | null) =>
    ({ getItem: () => value, setItem: vi.fn() }) as unknown as Storage

  it('reads a stored boolean and falls back to hidden subtitles otherwise', () => {
    expect(readVideoPlayerSetting(storageOf('{"isShowSubtitle":true}'))).toStrictEqual({
      isShowSubtitle: true,
    })
    for (const raw of [null, 'null', '5', '"x"', '{}', '{"isShowSubtitle":"yes"}', '{broken']) {
      expect(readVideoPlayerSetting(storageOf(raw))).toStrictEqual({ isShowSubtitle: false })
    }
    expect(readVideoPlayerSetting(undefined)).toStrictEqual({ isShowSubtitle: false })
  })

  it('reports whether the setting could be saved', () => {
    const storage = storageOf(null)

    expect(saveVideoPlayerSetting(storage, { isShowSubtitle: true })).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith('VideoPlayerSetting', '{"isShowSubtitle":true}')
    expect(saveVideoPlayerSetting(undefined, { isShowSubtitle: true })).toBe(false)
    const failing = {
      setItem: () => {
        throw new Error('full')
      },
    } as unknown as Storage
    expect(saveVideoPlayerSetting(failing, { isShowSubtitle: true })).toBe(false)
  })

  it('mounts the subtitle renderer for an HLS stream source, hls and m2tsll only', () => {
    const resolve = (sourceKind: never, streamingType?: never) =>
      resolveSubtitleRendererContract({
        sourceKind,
        streamingType,
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
      })

    expect(resolve('hls-stream' as never).rendererMounted).toBe(true)
    expect(resolve('direct-video' as never, 'hls' as never).rendererMounted).toBe(true)
    expect(resolve('direct-video' as never, 'm2tsll' as never).rendererMounted).toBe(true)
    expect(resolve('direct-video' as never, 'mp4' as never)).toStrictEqual({
      rendererMounted: false,
      rendererKind: 'none',
      strokeEnabled: false,
      isShowSubtitle: false,
      hasSubtitleTrack: false,
    })
    expect(resolve('direct-video' as never, 'm2ts' as never).rendererMounted).toBe(false)
  })
})

describe('MPEG-TS private data routing', () => {
  const packet = (stream_id: number, data: number[]) =>
    ({ stream_id, data: Uint8Array.from(data), pts: 9000, nearest_pts: undefined }) as never

  it('feeds caption data only for private stream 1 that starts with 0x80', () => {
    const feedB24 = vi.fn()
    pushMpegtsPrivateData({ caption: { feedB24 } }, packet(0xbd, [0x80, 1]))
    expect(feedB24).toHaveBeenCalledTimes(1)
    pushMpegtsPrivateData({ caption: { feedB24 } }, packet(0xbd, [0x00, 1]))
    expect(feedB24).toHaveBeenCalledTimes(1)
    pushMpegtsPrivateData({ caption: {} }, packet(0xbd, [0x80, 1]))
  })

  it('feeds superimpose data only for private stream 2 and when a feeder exists', () => {
    const feedB24 = vi.fn()
    pushMpegtsPrivateData({ superimpose: { feedB24 } }, packet(0xe0, [0x81, 1]))
    expect(feedB24).not.toHaveBeenCalled()
    expect(() => pushMpegtsPrivateData({}, packet(0xbf, [0x81, 1]))).not.toThrow()
    expect(() => pushMpegtsPrivateData({ superimpose: {} }, packet(0xbf, [0x81, 1]))).not.toThrow()
    pushMpegtsPrivateData({ superimpose: { feedB24 } }, packet(0xbf, [0x81, 1]))
    expect(feedB24).toHaveBeenCalledTimes(1)
  })

  it('skips the PES header only when a PTS or DTS is present in a malformed superimpose packet', () => {
    const feeds = (data: number[]) => {
      const feedB24 = vi.fn()
      pushMpegtsPrivateData({ superimpose: { feedB24 } }, packet(0xbf, data))
      return feedB24.mock.calls.map((call) => Array.from(call[0] as Uint8Array))
    }

    expect(feeds([0, 0x00, 2, 0x81, 0xaa])).toStrictEqual([[0x81, 0xaa]])
    expect(feeds([0, 0x40, 2, 0x81, 0xaa])).toStrictEqual([[0x81, 0xaa]])
    expect(feeds([0, 0x80, 2, 0xff, 0xff, 0x81, 0xaa])).toStrictEqual([[0x81, 0xaa]])
    expect(feeds([0, 0xc0, 2, 0xff, 0xff, 0x81, 0xaa])).toStrictEqual([[0x81, 0xaa]])
    expect(feeds([0, 0x00, 0, 0x01, 0xaa])).toStrictEqual([])
  })

  it('has no native subtitle adapter when the video has no text track', () => {
    const video = { textTracks: { length: 0, item: () => ({ mode: 'disabled' }) } } as never

    expect(createNativeTextTrackSubtitleAdapter(video)).toBeNull()
  })
})

describe('recorded video hand-off URLs', () => {
  const settings = new DefaultSettingsFactory().create()

  it('uses ./api when no base path is given and drops a trailing slash', () => {
    expect(buildVideoDownloadUrl({ videoFileId: 1 })).toBe('./api/videos/1?isDownload=true')
    expect(buildVideoDownloadUrl({ videoFileId: 1, basePath: '/x/' })).toBe(
      '/x/videos/1?isDownload=true',
    )
    expect(buildVideoPlaylistUrl({ videoFileId: 1 })).toBe('./api/videos/1/playlist')
    expect(buildVideoPlaylistUrl({ videoFileId: 1, basePath: '/x/' })).toBe('/x/videos/1/playlist')
    expect(
      buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: true,
        urlScheme: 'PROTOCOL://ADDRESS',
        videoFileId: 1,
        mode: 'view',
        origin: 'http://h',
        basePath: '/x/',
      }),
    ).toBe('http://h/x/videos/1')
  })

  it('builds the view URL scheme from the page location under a sub directory', () => {
    const target = buildRecordedPlaybackHandoffTarget({
      recordedId: 1,
      file: { id: 3, type: 'ts', filename: 'f.ts' },
      settings: {
        ...settings,
        shouldUseRecordedViewURLScheme: true,
        recordedViewURLScheme: 'PROTOCOL://ADDRESS/FILENAME',
      },
      browserHref: 'https://h:8080/sub/page.html',
    })

    expect(target).toStrictEqual({
      ok: true,
      kind: 'href',
      href: 'https://h:8080/sub/api/videos/3/f.ts',
    })
  })

  it('falls back to the playlist when the view URL scheme is off, blank or missing', () => {
    const base = { recordedId: 1, file: { id: 3, type: 'ts' }, browserHref: 'https://h/' }
    const playlist = { ok: true, kind: 'href', href: './api/videos/3/playlist' }

    expect(
      buildRecordedPlaybackHandoffTarget({
        ...base,
        settings: {
          ...settings,
          shouldUseRecordedViewURLScheme: false,
          recordedViewURLScheme: 'PROTOCOL://ADDRESS',
        },
      }),
    ).toStrictEqual(playlist)
    expect(
      buildRecordedPlaybackHandoffTarget({
        ...base,
        settings: {
          ...settings,
          shouldUseRecordedViewURLScheme: true,
          recordedViewURLScheme: '   ',
        },
      }),
    ).toStrictEqual(playlist)
    expect(
      buildRecordedPlaybackHandoffTarget({
        ...base,
        recordedViewUrlScheme: '   ',
        settings: {
          ...settings,
          shouldUseRecordedViewURLScheme: true,
          recordedViewURLScheme: null,
        },
      }),
    ).toStrictEqual(playlist)
    expect(
      buildRecordedPlaybackHandoffTarget({
        ...base,
        recordedViewUrlScheme: null,
        settings: {
          ...settings,
          shouldUseRecordedViewURLScheme: true,
          recordedViewURLScheme: null,
        },
      }),
    ).toStrictEqual(playlist)
  })
})

describe('recorded stream selection', () => {
  const storageOf = (value: string | null) => ({ getItem: () => value, setItem: vi.fn() })
  const stored = (raw: unknown) => storageOf(JSON.stringify(raw))
  const defaults = { type: 'WebM', mode: 0 }

  it('offers only stream types that have at least one mode', () => {
    const streamConfig = { recorded: { ts: { webm: ['a'], mp4: [], hls: undefined } } } as never

    expect(resolveRecordedStreamCandidates({ streamConfig, fileType: 'ts' })).toStrictEqual([
      { type: 'WebM', modes: ['a'] },
    ])
    expect(resolveRecordedStreamCandidates({ streamConfig, fileType: 'x' })).toStrictEqual([])
    expect(
      resolveRecordedStreamCandidates({ streamConfig: {} as never, fileType: 'ts' }),
    ).toStrictEqual([])
    expect(
      resolveRecordedStreamCandidates({ streamConfig: undefined, fileType: 'ts' }),
    ).toStrictEqual([])
  })

  it('reads a saved selection and falls back to the default for anything unusable', () => {
    expect(readRecordedSelectStreamSetting(stored({ type: 'MP4', mode: 2 }))).toStrictEqual({
      type: 'MP4',
      mode: 2,
    })
    expect(readRecordedSelectStreamSetting(stored({ type: 'HLS', mode: 'x' }))).toStrictEqual({
      type: 'HLS',
      mode: 0,
    })
    expect(readRecordedSelectStreamSetting(stored({ type: 'HLS', mode: 1.5 }))).toStrictEqual({
      type: 'HLS',
      mode: 0,
    })
    for (const raw of [{ mode: 1 }, { type: 'DASH', mode: 1 }, 5, null]) {
      expect(readRecordedSelectStreamSetting(stored(raw))).toStrictEqual(defaults)
    }
    expect(readRecordedSelectStreamSetting(storageOf(null))).toStrictEqual(defaults)
    expect(readRecordedSelectStreamSetting(undefined)).toStrictEqual(defaults)
    expect(RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY).toBeTruthy()
  })

  it('keeps a saved mode only while it is inside the available modes', () => {
    const candidates = [{ type: 'WebM', modes: ['a', 'b', 'c'] }] as never
    const normalize = (mode: unknown) =>
      normalizeRecordedSelectStreamSetting({ saved: { type: 'WebM', mode } as never, candidates })
        .mode

    expect(normalize(0)).toBe(0)
    expect(normalize(2)).toBe(2)
    expect(normalize(3)).toBe(0)
    expect(normalize(-1)).toBe(0)
    expect(normalize(1.5)).toBe(0)
    expect(normalize('1')).toBe(0)
  })

  it('builds a streaming route only from valid ids, type, mode and file type', () => {
    const selection = { type: 'MP4', mode: 1 } as never
    const failure = { ok: false, message: expect.any(String) }

    expect(
      buildRecordedStreamingRoute({ recordedId: 1, videoFileId: 2, fileType: 'ts', selection }),
    ).toStrictEqual({
      ok: true,
      to: '/recorded/streaming/2?recordedId=1&streamingType=mp4&mode=1&fileType=ts',
    })
    expect(
      buildRecordedStreamingRoute({
        recordedId: 1,
        videoFileId: undefined,
        fileType: 'ts',
        selection,
      }),
    ).toStrictEqual(failure)
    expect(
      buildRecordedStreamingRoute({
        recordedId: undefined,
        videoFileId: 2,
        fileType: 'ts',
        selection,
      }),
    ).toStrictEqual(failure)
    expect(
      buildRecordedStreamingRoute({
        recordedId: 1,
        videoFileId: 2,
        fileType: 'ts',
        selection: null,
      }),
    ).toStrictEqual(failure)
    expect(
      buildRecordedStreamingRoute({
        recordedId: 1,
        videoFileId: 2,
        fileType: 'ts',
        selection: { type: 'DASH', mode: 1 } as never,
      }),
    ).toStrictEqual(failure)
    expect(
      buildRecordedStreamingRoute({
        recordedId: 1,
        videoFileId: 2,
        fileType: 'ts',
        selection: { type: 'MP4', mode: -1 },
      }),
    ).toStrictEqual(failure)
    expect(
      buildRecordedStreamingRoute({ recordedId: 1, videoFileId: 2, fileType: 'x', selection }),
    ).toStrictEqual(failure)
    expect(buildRecordedStreamingRoute({ recordedId: 1, videoFileId: 2, selection })).toStrictEqual(
      failure,
    )
  })
})

describe('playback constant tables', () => {
  const recordingStorage = (value: string | null) => ({
    getItem: vi.fn((): string | null => value),
    setItem: vi.fn(),
  })

  it('names the error shown for each kind of invalid watch route', () => {
    expect(resolveLiveWatchRoute({ search: '?type=hls', streamConfig: liveConfig })).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
    expect(resolveRecordedWatchRoute('')).toStrictEqual({
      ok: false,
      message: '再生対象が不正です',
    })
    expect(resolveRecordedWatchRoute('?videoId=x')).toStrictEqual({
      ok: false,
      message: '再生対象が不正です',
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: undefined,
        search: '?streamingType=hls&fileType=ts&mode=0&recordedId=9',
      }),
    ).toStrictEqual({ ok: false, message: 'ストリーム再生条件が不正です' })
  })

  it('reads and saves the video player setting under its own key and starts with hidden subtitles', () => {
    const storage = recordingStorage(null)

    expect(readVideoPlayerSetting(storage as unknown as Storage)).toStrictEqual({
      isShowSubtitle: false,
    })
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith('VideoPlayerSetting')
    expect(readVideoPlayerSetting(undefined)).toStrictEqual({ isShowSubtitle: false })
    expect(
      readVideoPlayerSetting(recordingStorage('{"isShowSubtitle":"x"}') as unknown as Storage),
    ).toStrictEqual({ isShowSubtitle: false })
  })

  it('selects WebM mode 0 by default and names the stream types in the route query', () => {
    expect(readRecordedSelectStreamSetting(undefined)).toStrictEqual({ type: 'WebM', mode: 0 })
    expect(
      normalizeRecordedSelectStreamSetting({ saved: { type: 'HLS', mode: 5 }, candidates: [] }),
    ).toStrictEqual({ type: 'WebM', mode: 0 })

    for (const [type, query] of [
      ['WebM', 'webm'],
      ['MP4', 'mp4'],
      ['HLS', 'hls'],
    ] as const) {
      expect(
        buildRecordedStreamingRoute({
          recordedId: 1,
          videoFileId: 2,
          fileType: 'encoded',
          selection: { type, mode: 0 },
        }),
      ).toStrictEqual({
        ok: true,
        to: `/recorded/streaming/2?recordedId=1&streamingType=${query}&mode=0&fileType=encoded`,
      })
    }
  })

  it('keeps the recorded stream selection under its own key', () => {
    const storage = recordingStorage('{"type":"HLS","mode":1}')

    expect(readRecordedSelectStreamSetting(storage)).toStrictEqual({ type: 'HLS', mode: 1 })
    writeRecordedSelectStreamSetting(storage, { type: 'MP4', mode: 2 })

    expect(RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY).toBe('RecordedSelectStreamSetting')
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith('RecordedSelectStreamSetting')
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(
      'RecordedSelectStreamSetting',
      '{"type":"MP4","mode":2}',
    )
    expect(() =>
      writeRecordedSelectStreamSetting(undefined, { type: 'MP4', mode: 2 }),
    ).not.toThrow()
  })
})
