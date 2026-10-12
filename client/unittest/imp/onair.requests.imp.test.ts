import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ONAIR_QUERY_KEY,
  adaptOnAirReserveIndexForProgramDialog,
  buildLiveM2TSPlaylistUrl,
  buildLiveM2TSUrlSchemeUrl,
  buildOnAirRequestUrls,
  buildOnAirWatchRoute,
  clampOnAirProgress,
  createOnAirQueryKey,
  normalizeOnAirSelectStreamSetting,
  readOnAirSelectStreamSetting,
  resolveEnabledOnAirTabs,
  resolveLiveM2TSUrlSchemeTemplate,
  resolveLiveStreamCandidates,
  resolveOnAirUpdateDelay,
  resolveWatchInfoDisplay,
  resolveWatchInfoUpdateDelay,
  transformOnAirReserveListsToIndex,
  writeOnAirSelectStreamSetting,
} from '@/features/onair/onairRequests'

describe('On Air request builder implementation edges', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('builds reserve and broadcasting URLs without sending a broadcasting time query', () => {
    expect(
      buildOnAirRequestUrls({
        isHalfWidth: false,
        reserveStartAt: Date.parse('2026-05-05T09:00:00+09:00'),
        basePath: '/api/',
      }),
    ).toStrictEqual({
      reserveIndex: '/api/reserves/lists?startAt=1777939200000&endAt=1777942800000',
      broadcasting: '/api/schedules/broadcasting?isHalfWidth=false',
    })
    expect(createOnAirQueryKey({ isHalfWidth: false })).toStrictEqual([
      ...ONAIR_QUERY_KEY,
      { isHalfWidth: false },
    ])
  })

  it('transforms reserve lists with normal, conflict, skip, then overlap priority', () => {
    expect(
      transformOnAirReserveListsToIndex({
        normal: [{ reserveId: 1, programId: 10, ruleId: 100 }],
        conflicts: [{ reserveId: 2, programId: 10, ruleId: 200 }],
        skips: [{ reserveId: 3, programId: 10, ruleId: 300 }],
        overlaps: [{ reserveId: 4, programId: 10, ruleId: 400 }],
      }),
    ).toStrictEqual({
      10: {
        type: 'overlap',
        item: { reserveId: 4, programId: 10, ruleId: 400 },
      },
    })
  })

  it('converts On Air reserveId items to the Guide ProgramDialog reserve index shape', () => {
    expect(
      adaptOnAirReserveIndexForProgramDialog({
        10: {
          type: 'skip',
          item: { reserveId: 100, programId: 10, ruleId: 20 },
        },
      }),
    ).toStrictEqual({
      10: {
        type: 'skip',
        item: { id: 100, programId: 10, ruleId: 20 },
      },
    })
  })

  it('orders enabled tabs by broadcast wave and ignores disabled waves', () => {
    expect(resolveEnabledOnAirTabs(['SKY', 'GR', 'CS'])).toStrictEqual(['GR', 'CS', 'SKY'])
  })

  it('places BS4K last, after SKY, when it is an enabled tab', () => {
    expect(resolveEnabledOnAirTabs(['BS4K', 'SKY', 'GR', 'CS', 'BS'])).toStrictEqual([
      'GR',
      'BS',
      'CS',
      'SKY',
      'BS4K',
    ])
  })

  it('resolves 1 second retry for empty schedules and clamps progress', () => {
    expect(resolveOnAirUpdateDelay([], Date.parse('2026-05-05T09:00:00+09:00'))).toBe(1000)
    expect(
      resolveOnAirUpdateDelay(
        [
          {
            channel: { id: 1, name: 'Synthetic', channelType: 'GR' },
            programs: [
              {
                id: 10,
                name: 'Synthetic program',
                startAt: Date.parse('2026-05-05T08:00:00+09:00'),
                endAt: Date.parse('2026-05-05T09:30:00+09:00'),
              },
            ],
          },
          {
            channel: { id: 2, name: 'Synthetic 2', channelType: 'BS' },
            programs: [
              {
                id: 20,
                name: 'Synthetic program 2',
                startAt: Date.parse('2026-05-05T08:00:00+09:00'),
                endAt: Date.parse('2026-05-05T10:00:00+09:00'),
              },
            ],
          },
        ],
        Date.parse('2026-05-05T09:00:00+09:00'),
      ),
    ).toBe(30 * 60 * 1000)
    expect(clampOnAirProgress(-10)).toBe(0)
    expect(clampOnAirProgress(50)).toBe(50)
    expect(clampOnAirProgress(150)).toBe(100)
  })

  it('generates live stream candidates from server config in URL scheme and web playback order', () => {
    const streamConfig = {
      live: {
        ts: {
          m2ts: [{ name: 'm2ts-default' }],
          m2tsll: ['ll-low'],
          webm: ['webm-low'],
          mp4: ['mp4-low'],
          hls: ['hls-low'],
        },
      },
    }

    expect(resolveLiveStreamCandidates({ streamConfig, useURLScheme: true })).toStrictEqual([
      { type: 'M2TS', modes: ['m2ts-default'] },
    ])
    expect(resolveLiveStreamCandidates({ streamConfig, useURLScheme: false })).toStrictEqual([
      { type: 'M2TS-LL', modes: ['ll-low'] },
      { type: 'WebM', modes: ['webm-low'] },
      { type: 'MP4', modes: ['mp4-low'] },
      { type: 'HLS', modes: ['hls-low'] },
    ])
    expect(
      resolveLiveStreamCandidates({
        streamConfig: { live: { ts: { m2tsll: ['ll-low'] } } },
        useURLScheme: true,
      }),
    ).toStrictEqual([])
  })

  it('normalizes and saves OnAirSelectStreamSetting against current candidates', () => {
    const storage = window.localStorage
    storage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: false, type: 'HLS', mode: 9 }),
    )
    const candidates = [
      { type: 'WebM' as const, modes: ['webm-low'] },
      { type: 'HLS' as const, modes: ['hls-low'] },
    ]

    expect(readOnAirSelectStreamSetting(storage)).toStrictEqual({
      useURLScheme: false,
      type: 'HLS',
      mode: 9,
    })
    expect(
      normalizeOnAirSelectStreamSetting({
        saved: readOnAirSelectStreamSetting(storage),
        candidates,
      }),
    ).toStrictEqual({
      useURLScheme: false,
      type: 'HLS',
      mode: 0,
    })

    writeOnAirSelectStreamSetting(storage, { useURLScheme: true, type: 'M2TS', mode: 1 })

    expect(JSON.parse(storage.getItem('OnAirSelectStreamSetting') ?? '{}')).toStrictEqual({
      useURLScheme: true,
      type: 'M2TS',
      mode: 1,
    })
    expect(
      normalizeOnAirSelectStreamSetting({
        saved: { useURLScheme: false, type: 'MP4', mode: 0 },
        candidates,
      }),
    ).toStrictEqual({
      useURLScheme: false,
      type: 'WebM',
      mode: 0,
    })
  })

  it('builds M2TS URL scheme, playlist fallback, and live watch routes', () => {
    expect(
      buildLiveM2TSUrlSchemeUrl({
        channelId: 10,
        mode: 2,
        browserHref: 'https://example.invalid/epgstation/#/onair',
        template: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS',
      }),
    ).toBe(
      'vlc-x-callback://x-callback-url/stream?url=https://example.invalid%2Fepgstation%2Fapi%2Fstreams%2Flive%2F10%2Fm2ts%3Fmode%3D2',
    )
    expect(buildLiveM2TSPlaylistUrl({ channelId: 10, mode: 2, basePath: '/api/' })).toBe(
      '/api/streams/live/10/m2ts/playlist?mode=2',
    )
    expect(buildOnAirWatchRoute({ type: 'M2TS-LL', channelId: 10, mode: 2 })).toBe(
      '/onair/watch?type=m2tsll&channel=10&mode=2',
    )
    expect(buildOnAirWatchRoute({ type: 'WebM', channelId: 10, mode: 2 })).toBe(
      '/onair/watch?type=webm&channel=10&mode=2',
    )
  })

  it('uses the saved M2TS URL scheme first and otherwise falls back to platform config', () => {
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: 'custom://PROTOCOL/ADDRESS',
        serverUrlScheme: {
          m2ts: {
            ios: 'ios://PROTOCOL/ADDRESS',
          },
        },
        platform: 'ios',
      }),
    ).toBe('custom://PROTOCOL/ADDRESS')
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: '   ',
        serverUrlScheme: {
          m2ts: {
            ios: 'ios://PROTOCOL/ADDRESS',
            android: 'intent://ADDRESS#Intent;scheme=PROTOCOL;end',
          },
        },
        platform: 'android',
      }),
    ).toBe('intent://ADDRESS#Intent;scheme=PROTOCOL;end')
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: {
          m2ts: {
            ios: 'ios://PROTOCOL/ADDRESS',
          },
        },
        platform: 'mac',
      }),
    ).toBeNull()
  })

  it('matches watch info only by channel and mode and resolves refresh delay', () => {
    const now = Date.parse('2026-05-05T09:00:00+09:00')
    const matching = {
      channelId: 10,
      mode: 2,
      type: 'backend-internal',
      name: 'Synthetic Live',
      description: 'Synthetic live description',
      startAt: now - 30 * 60 * 1000,
      endAt: now + 20 * 60 * 1000,
    }

    expect(
      resolveWatchInfoDisplay({
        items: [
          { ...matching, channelId: 11 },
          { ...matching, channelName: 'Synthetic Channel' },
        ],
        channelId: 10,
        mode: 2,
      }),
    ).toStrictEqual({
      channelName: 'Synthetic Channel',
      time: '05/05(火) 08:30 ~ 09:20',
      name: 'Synthetic Live',
      description: 'Synthetic live description',
      endAt: now + 20 * 60 * 1000,
    })
    expect(resolveWatchInfoUpdateDelay({ item: matching, now })).toBe(20 * 60 * 1000)
    expect(resolveWatchInfoUpdateDelay({ item: undefined, now })).toBe(1000)
    expect(resolveWatchInfoUpdateDelay({ item: { ...matching, endAt: now }, now })).toBe(1000)
  })
})
