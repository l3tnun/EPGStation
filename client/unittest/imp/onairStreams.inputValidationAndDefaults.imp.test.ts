import { describe, expect, it, vi } from 'vitest'
import {
  appendCandidate,
  buildLiveM2TSUrlSchemeUrl,
  buildOnAirRequestUrls,
  buildOnAirStreamsUrl,
  formatWatchInfoTime,
  isLiveStreamType,
  isRecord,
  normalizeMode,
  readOnAirSelectStreamSetting,
  resolveLiveM2TSUrlSchemeTemplate,
  resolveLiveStreamCandidates,
  writeOnAirSelectStreamSetting,
} from '@/features/onair/lib/onairStreams'
import type { LiveStreamCandidate } from '@/features/onair/lib/onairRequestTypes'

function createStorage(value: string | null): Storage {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  } as unknown as Storage
}

describe('onairStreams input validation and defaults', () => {
  it('isRecord accepts only non-null objects', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('text')).toBe(false)
    expect(isRecord(1)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })

  it('isLiveStreamType accepts exactly the five stream types', () => {
    for (const type of ['M2TS', 'M2TS-LL', 'WebM', 'MP4', 'HLS']) {
      expect(isLiveStreamType(type)).toBe(true)
    }
    for (const value of ['', 'm2ts', 'webm', 'mp4', 'hls', 'M2TS-ll', null, 1]) {
      expect(isLiveStreamType(value)).toBe(false)
    }
  })

  it('appendCandidate skips undefined and empty mode lists and appends non-empty ones', () => {
    const candidates: LiveStreamCandidate[] = []
    appendCandidate(candidates, 'WebM', undefined)
    appendCandidate(candidates, 'WebM', [])
    expect(candidates).toEqual([])
    appendCandidate(candidates, 'MP4', ['a'])
    expect(candidates).toEqual([{ type: 'MP4', modes: ['a'] }])
  })

  it('formatWatchInfoTime renders every weekday in Japanese', () => {
    // 2026-05-03 is a Sunday in Asia/Tokyo.
    const names = ['日', '月', '火', '水', '木', '金', '土']
    names.forEach((name, offset) => {
      const startAt = Date.parse(`2026-05-0${3 + offset}T09:00:00+09:00`)
      const endAt = Date.parse(`2026-05-0${3 + offset}T10:30:00+09:00`)
      expect(formatWatchInfoTime(startAt, endAt)).toBe(`05/0${3 + offset}(${name}) 09:00 ~ 10:30`)
    })
  })

  it('normalizeMode accepts only safe integers inside [0, maxLength)', () => {
    expect(normalizeMode(0, 3)).toBe(0)
    expect(normalizeMode(1, 3)).toBe(1)
    expect(normalizeMode(2, 3)).toBe(2)
    expect(normalizeMode(3, 3)).toBe(0)
    expect(normalizeMode(-1, 3)).toBe(0)
    expect(normalizeMode(1.5, 3)).toBe(0)
    expect(normalizeMode(Number.NaN, 3)).toBe(0)
    expect(normalizeMode(Infinity, 3)).toBe(0)
    expect(normalizeMode('1', 3)).toBe(0)
    expect(normalizeMode(undefined, 3)).toBe(0)
    expect(normalizeMode(null, 3)).toBe(0)
    expect(normalizeMode(0, 0)).toBe(0)
    expect(normalizeMode(1, 1)).toBe(0)
  })

  it('request URL builders default the base path to ./api', () => {
    const urls = buildOnAirRequestUrls({ isHalfWidth: false, reserveStartAt: 5 })
    expect(urls.reserveIndex).toBe('./api/reserves/lists?startAt=5&endAt=3600005')
    expect(urls.broadcasting).toBe('./api/schedules/broadcasting?isHalfWidth=false')
    expect(buildOnAirStreamsUrl({ isHalfWidth: true })).toBe('./api/streams?isHalfWidth=true')
  })

  it('resolveLiveStreamCandidates returns no candidates when live config is missing', () => {
    expect(resolveLiveStreamCandidates({ streamConfig: {} as never, useURLScheme: false })).toEqual(
      [],
    )
    expect(resolveLiveStreamCandidates({ streamConfig: {} as never, useURLScheme: true })).toEqual(
      [],
    )
    expect(resolveLiveStreamCandidates({ streamConfig: undefined, useURLScheme: false })).toEqual(
      [],
    )
  })

  it('resolveLiveStreamCandidates lists the named URL scheme modes and drops empty names', () => {
    const streamConfig = {
      live: { ts: { m2ts: [{ name: 'a' }, { name: '' }, { name: 'b' }] } },
    } as never
    expect(resolveLiveStreamCandidates({ streamConfig, useURLScheme: true })).toEqual([
      { type: 'M2TS', modes: ['a', 'b'] },
    ])
    expect(
      resolveLiveStreamCandidates({
        streamConfig: { live: { ts: { m2ts: [{ name: '' }] } } } as never,
        useURLScheme: true,
      }),
    ).toEqual([])
    expect(
      resolveLiveStreamCandidates({
        streamConfig: { live: { ts: {} } } as never,
        useURLScheme: true,
      }),
    ).toEqual([])
  })

  it('readOnAirSelectStreamSetting restores a saved setting and defaults a bad mode to 0', () => {
    const read = (value: unknown) =>
      readOnAirSelectStreamSetting(createStorage(JSON.stringify(value)))
    expect(read({ useURLScheme: true, type: 'HLS', mode: 2 })).toEqual({
      useURLScheme: true,
      type: 'HLS',
      mode: 2,
    })
    expect(read({ useURLScheme: false, type: 'MP4' })).toEqual({
      useURLScheme: false,
      type: 'MP4',
      mode: 0,
    })
    expect(read({ useURLScheme: false, type: 'MP4', mode: 1.5 })).toEqual({
      useURLScheme: false,
      type: 'MP4',
      mode: 0,
    })
    expect(read({ useURLScheme: false, type: 'MP4', mode: '1' }).mode).toBe(0)
  })

  it('readOnAirSelectStreamSetting returns the default when nothing usable is stored', () => {
    const fallback = { useURLScheme: false, type: 'M2TS', mode: 0 }
    expect(readOnAirSelectStreamSetting(undefined)).toEqual(fallback)
    expect(readOnAirSelectStreamSetting(createStorage(null))).toEqual(fallback)
    expect(readOnAirSelectStreamSetting(createStorage('{bad'))).toEqual(fallback)
    expect(readOnAirSelectStreamSetting(createStorage('5'))).toEqual(fallback)
  })

  it('writeOnAirSelectStreamSetting tolerates missing storage and writes JSON under the key', () => {
    const setting = { useURLScheme: true, type: 'WebM', mode: 1 } as const
    expect(() => writeOnAirSelectStreamSetting(undefined, setting)).not.toThrow()
    const storage = createStorage(null)
    writeOnAirSelectStreamSetting(storage, setting)
    expect(storage.setItem).toHaveBeenCalledWith(
      'OnAirSelectStreamSetting',
      JSON.stringify(setting),
    )
  })

  it('buildLiveM2TSUrlSchemeUrl defaults the base path and only strips a leading ./', () => {
    const base = {
      channelId: 3,
      mode: 1,
      browserHref: 'https://example.com/sub/index.html',
      template: 'x://ADDRESS',
    }
    expect(buildLiveM2TSUrlSchemeUrl(base)).toBe(
      'x://example.com/sub/api/streams/live/3/m2ts?mode=1',
    )
    expect(buildLiveM2TSUrlSchemeUrl({ ...base, basePath: 'a/./b' })).toBe(
      'x://example.com/suba/./b/streams/live/3/m2ts?mode=1',
    )
  })

  it('buildLiveM2TSUrlSchemeUrl drops a trailing slash of the base path', () => {
    const base = {
      channelId: 3,
      mode: 1,
      browserHref: 'https://example.com/sub/index.html',
      template: 'x://ADDRESS',
    }
    expect(buildLiveM2TSUrlSchemeUrl({ ...base, basePath: './api/' })).toBe(
      'x://example.com/sub/api/streams/live/3/m2ts?mode=1',
    )
    expect(buildLiveM2TSUrlSchemeUrl({ ...base, basePath: '/api/' })).toBe(
      'x://example.com/sub/api/streams/live/3/m2ts?mode=1',
    )
  })

  it('resolveLiveM2TSUrlSchemeTemplate tolerates a missing url scheme config', () => {
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: undefined,
        platform: 'ios',
      }),
    ).toBeNull()
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: {} as never,
        platform: 'ios',
      }),
    ).toBeNull()
    expect(
      resolveLiveM2TSUrlSchemeTemplate({
        savedTemplate: null,
        serverUrlScheme: { m2ts: { ios: 'vlc://ADDRESS' } } as never,
        platform: 'ios',
      }),
    ).toBe('vlc://ADDRESS')
  })
})
