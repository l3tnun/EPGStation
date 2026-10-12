import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEndpointUrl,
  buildLiveM2TSPlaylistUrl,
  buildLiveM2TSUrlSchemeUrl,
  buildOnAirRequestUrls,
  buildOnAirStreamsUrl,
  formatWatchInfoTime,
  normalizeOnAirSelectStreamSetting,
  readOnAirSelectStreamSetting,
  resolveLiveM2TSUrlSchemeTemplate,
  resolveLiveStreamCandidates,
} from '@/features/onair/lib/onairStreams'

describe('onairStreams pure helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('buildEndpointUrl omits the query string entirely when there are no parameters', () => {
    expect(buildEndpointUrl('./api', '/streams', new URLSearchParams())).toBe('./api/streams')
    expect(buildEndpointUrl('./api/', '/streams', new URLSearchParams())).toBe('./api/streams')
  })

  it('buildOnAirRequestUrls and buildOnAirStreamsUrl build endpoints from the given base path', () => {
    const urls = buildOnAirRequestUrls({
      isHalfWidth: true,
      reserveStartAt: 1000,
      basePath: '/api',
    })
    expect(urls.reserveIndex).toBe('/api/reserves/lists?startAt=1000&endAt=3601000')
    expect(urls.broadcasting).toBe('/api/schedules/broadcasting?isHalfWidth=true')
    expect(buildOnAirStreamsUrl({ isHalfWidth: false, basePath: '/api' })).toBe(
      '/api/streams?isHalfWidth=false',
    )
  })

  it('formatWatchInfoTime returns an empty string when startAt or endAt is missing', () => {
    expect(formatWatchInfoTime(undefined, 1)).toBe('')
    expect(formatWatchInfoTime(1, undefined)).toBe('')
  })

  it('formatWatchInfoTime falls back to Sun/日 when the weekday part cannot be resolved', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([])
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')
    const endAt = Date.parse('2026-05-05T10:00:00+09:00')

    expect(formatWatchInfoTime(startAt, endAt)).toBe('05/05(日) 09:00 ~ 10:00')
    spy.mockRestore()
  })

  it('formatWatchInfoTime falls back to 日 when the weekday token is unrecognized', () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockReturnValue([{ type: 'weekday', value: 'Xyz' } as Intl.DateTimeFormatPart])
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')
    const endAt = Date.parse('2026-05-05T10:00:00+09:00')

    expect(formatWatchInfoTime(startAt, endAt)).toBe('05/05(日) 09:00 ~ 10:00')
    spy.mockRestore()
  })

  it('resolveLiveStreamCandidates returns no candidates when the ts config is missing', () => {
    expect(
      resolveLiveStreamCandidates({ streamConfig: undefined, useURLScheme: false }),
    ).toStrictEqual([])
    expect(
      resolveLiveStreamCandidates({ streamConfig: { live: {} }, useURLScheme: true }),
    ).toStrictEqual([])
  })

  it('readOnAirSelectStreamSetting returns the default when storage is undefined', () => {
    expect(readOnAirSelectStreamSetting(undefined)).toStrictEqual({
      useURLScheme: false,
      type: 'M2TS',
      mode: 0,
    })
  })

  it('readOnAirSelectStreamSetting returns the default when the saved value is malformed', () => {
    const storage = { getItem: vi.fn(() => 'not-json') } as unknown as Storage
    expect(readOnAirSelectStreamSetting(storage)).toStrictEqual({
      useURLScheme: false,
      type: 'M2TS',
      mode: 0,
    })

    const storageWithBadShape = {
      getItem: vi.fn(() => JSON.stringify({ useURLScheme: 'not-boolean', type: 'M2TS' })),
    } as unknown as Storage
    expect(readOnAirSelectStreamSetting(storageWithBadShape)).toStrictEqual({
      useURLScheme: false,
      type: 'M2TS',
      mode: 0,
    })
  })

  it('readOnAirSelectStreamSetting normalizes a non-integer saved mode to zero', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ useURLScheme: true, type: 'HLS', mode: 'bad' })),
    } as unknown as Storage
    expect(readOnAirSelectStreamSetting(storage)).toStrictEqual({
      useURLScheme: true,
      type: 'HLS',
      mode: 0,
    })
  })

  it('normalizeOnAirSelectStreamSetting falls back to the default type when there are no candidates', () => {
    expect(
      normalizeOnAirSelectStreamSetting({
        saved: { useURLScheme: false, type: 'HLS', mode: 2 },
        candidates: [],
      }),
    ).toStrictEqual({ useURLScheme: false, type: 'M2TS', mode: 0 })
  })

  it('buildLiveM2TSUrlSchemeUrl returns null when the template is null, undefined, or blank', () => {
    const options = {
      channelId: 1,
      mode: 0,
      browserHref: 'https://example.invalid/onair',
    }
    expect(buildLiveM2TSUrlSchemeUrl({ ...options, template: null })).toBeNull()
    expect(buildLiveM2TSUrlSchemeUrl({ ...options, template: undefined })).toBeNull()
    expect(buildLiveM2TSUrlSchemeUrl({ ...options, template: '   ' })).toBeNull()
  })

  it('buildLiveM2TSUrlSchemeUrl keeps the address unescaped for a plain template', () => {
    expect(
      buildLiveM2TSUrlSchemeUrl({
        channelId: 1,
        mode: 0,
        browserHref: 'https://example.invalid/onair',
        template: 'vlc://PROTOCOL://ADDRESS',
        basePath: './api',
      }),
    ).toBe('vlc://https://example.invalid/api/streams/live/1/m2ts?mode=0')
  })

  it('buildLiveM2TSUrlSchemeUrl percent-encodes the address for a vlc-x-callback template', () => {
    const url = buildLiveM2TSUrlSchemeUrl({
      channelId: 1,
      mode: 0,
      browserHref: 'https://example.invalid/onair',
      template: 'vlc-x-callback://x-callback-url/stream?url=ADDRESS&scheme=PROTOCOL',
      basePath: './api',
    })

    expect(url).toBe(
      `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(
        'example.invalid/api/streams/live/1/m2ts?mode=0',
      )}&scheme=https`,
    )
  })

  it('buildLiveM2TSUrlSchemeUrl reproduces the exact vlc-x-callback URL from the shipped iOS m2ts default (config.yml.template / Configuration.DEFAULT_VALUE urlscheme.m2ts.ios)', () => {
    // iOS 側の VLC (`vlc-x-callback`) は url= の値を丸ごと percent-decode してから URL として開く
    // (videolan/vlc-ios Sources/Helpers/Network/URLHandler.swift の getURLForValue)。この template は
    // その decode を前提に PROTOCOL の後ろへ "://" を %3A%2F%2F として埋め込んでいるので、ADDRESS へ
    // encodeURIComponent した値を差し込むと、url= 全体を一度 decode しただけで元の絶対 URL に戻る。
    const shippedIOSM2TSTemplate =
      'vlc-x-callback://x-callback-url/stream?url=PROTOCOL%3A%2F%2FADDRESS'

    const url = buildLiveM2TSUrlSchemeUrl({
      channelId: 1,
      mode: 0,
      browserHref: 'https://example.invalid/onair',
      template: shippedIOSM2TSTemplate,
      basePath: './api',
    })

    expect(url).toBe(
      'vlc-x-callback://x-callback-url/stream?url=https%3A%2F%2Fexample.invalid%2Fapi%2Fstreams%2Flive%2F1%2Fm2ts%3Fmode%3D0',
    )

    // VLC 側 (getURLForValue) は "?" 以降を自前で "&"/"=" 分割して url= の生の値を取り出し、それを
    // 丸ごと一度だけ percent-decode する。ブラウザの URL/URLSearchParams は使わず同じ手順で確かめる。
    const rawQueryValue = (url ?? '').split('?url=')[1]
    expect(decodeURIComponent(rawQueryValue ?? '')).toBe(
      'https://example.invalid/api/streams/live/1/m2ts?mode=0',
    )
  })

  it('buildLiveM2TSPlaylistUrl builds the direct playlist path', () => {
    expect(buildLiveM2TSPlaylistUrl({ channelId: 10, mode: 1, basePath: '/api/' })).toBe(
      '/api/streams/live/10/m2ts/playlist?mode=1',
    )
  })

  it('buildLiveM2TSPlaylistUrl defaults to the relative ./api base so it resolves under any subDirectory', () => {
    const playlistUrl = buildLiveM2TSPlaylistUrl({ channelId: 10, mode: 1 })

    expect(playlistUrl).toBe('./api/streams/live/10/m2ts/playlist?mode=1')
    expect(playlistUrl.startsWith('/')).toBe(false)

    // 文書の URL は HashRouter のため `#/...` が変わるだけで path は変わらない。
    expect(new URL(playlistUrl, 'https://example.invalid/#/onair').href).toBe(
      'https://example.invalid/api/streams/live/10/m2ts/playlist?mode=1',
    )
    expect(new URL(playlistUrl, 'https://example.invalid/epgstation/#/onair').href).toBe(
      'https://example.invalid/epgstation/api/streams/live/10/m2ts/playlist?mode=1',
    )
    expect(new URL(playlistUrl, 'https://example.invalid/a/b/#/onair/watch').href).toBe(
      'https://example.invalid/a/b/api/streams/live/10/m2ts/playlist?mode=1',
    )
  })

  it('resolveLiveM2TSUrlSchemeTemplate falls back to the platform-specific server template', () => {
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: { m2ts: { mac: 'vlc://PROTOCOL://ADDRESS' } },
        platform: 'mac',
      }),
    ).toBe('vlc://PROTOCOL://ADDRESS')
  })

  it('resolveLiveM2TSUrlSchemeTemplate returns null when the platform is null', () => {
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: { m2ts: { mac: 'vlc://PROTOCOL://ADDRESS' } },
        platform: null,
      }),
    ).toBeNull()
  })

  it('resolveLiveM2TSUrlSchemeTemplate prefers a non-blank saved template', () => {
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: 'custom://PROTOCOL/ADDRESS',
        serverUrlScheme: undefined,
        platform: null,
      }),
    ).toBe('custom://PROTOCOL/ADDRESS')
  })
})
