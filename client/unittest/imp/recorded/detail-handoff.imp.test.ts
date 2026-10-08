import { describe, expect, it } from 'vitest'
import {
  buildRecordedPlaybackHandoffTarget,
  buildRecordedStreamingRoute,
  linkifyRecordedExtendedText,
  normalizeRecordedSelectStreamSetting,
  readSendVideoFileSelectHostSetting,
  readRecordedSelectStreamSetting,
  resolveRecordedStreamCandidates,
  resolveKodiHostName,
  writeRecordedSelectStreamSetting,
  writeSendVideoFileSelectHostSetting,
} from '@/features/recorded/recordedRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Recorded detail implementation edges', () => {
  it('safe-linkifies only http and https text into external link tokens', () => {
    expect(
      linkifyRecordedExtendedText(
        'before https://example.invalid/path?q=1 after javascript:alert(1) http://example.invalid/a',
      ),
    ).toStrictEqual([
      { type: 'text', text: 'before ' },
      {
        type: 'link',
        text: 'https://example.invalid/path?q=1',
        href: 'https://example.invalid/path?q=1',
      },
      { type: 'text', text: ' after javascript:alert(1) ' },
      { type: 'link', text: 'http://example.invalid/a', href: 'http://example.invalid/a' },
    ])
  })

  it('selects web watch only for encoded files when preferred and falls back to playlist after URL scheme', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isPreferredPlayingOnWeb: true,
      shouldUseRecordedViewURLScheme: true,
      recordedViewURLScheme: 'synthetic://PROTOCOL/ADDRESS/FILENAME',
    }

    expect(
      buildRecordedPlaybackHandoffTarget({
        recordedId: 301,
        file: {
          id: 702,
          type: 'encoded',
          filename: 'synthetic-encoded.mp4',
        },
        settings,
        browserHref: 'https://example.invalid/epgstation/#/recorded/detail/301',
      }),
    ).toStrictEqual({
      ok: true,
      kind: 'route',
      to: '/recorded/watch?videoId=702&recordedId=301',
    })

    expect(
      buildRecordedPlaybackHandoffTarget({
        recordedId: 301,
        file: {
          id: 701,
          type: 'ts',
          filename: 'synthetic-original.ts',
        },
        settings,
        browserHref: 'https://example.invalid/epgstation/#/recorded/detail/301',
      }),
    ).toStrictEqual({
      ok: true,
      kind: 'href',
      href: 'synthetic://https/example.invalid/epgstation/api/videos/701/synthetic-original.ts',
    })

    expect(
      buildRecordedPlaybackHandoffTarget({
        recordedId: 301,
        file: {
          id: 701,
          type: 'ts',
          filename: 'synthetic-original.ts',
        },
        settings: {
          ...settings,
          recordedViewURLScheme: null,
        },
        browserHref: 'https://example.invalid/epgstation/#/recorded/detail/301',
      }),
    ).toStrictEqual({
      ok: true,
      kind: 'href',
      href: './api/videos/701/playlist',
    })
  })

  it('restores recorded stream setting and builds validated streaming routes', () => {
    const storage = window.localStorage
    const streamConfig = {
      recorded: {
        encoded: {
          mp4: ['encoded-mp4'],
          hls: ['encoded-hls'],
        },
      },
    }

    storage.setItem('RecordedSelectStreamSetting', JSON.stringify({ type: 'HLS', mode: 9 }))

    expect(readRecordedSelectStreamSetting(storage)).toStrictEqual({ type: 'HLS', mode: 9 })
    expect(
      resolveRecordedStreamCandidates({
        streamConfig,
        fileType: 'encoded',
      }),
    ).toStrictEqual([
      { type: 'MP4', modes: ['encoded-mp4'] },
      { type: 'HLS', modes: ['encoded-hls'] },
    ])
    expect(
      normalizeRecordedSelectStreamSetting({
        saved: readRecordedSelectStreamSetting(storage),
        candidates: resolveRecordedStreamCandidates({ streamConfig, fileType: 'encoded' }),
      }),
    ).toStrictEqual({ type: 'HLS', mode: 0 })

    writeRecordedSelectStreamSetting(storage, { type: 'MP4', mode: 0 })
    expect(JSON.parse(storage.getItem('RecordedSelectStreamSetting') ?? '{}')).toStrictEqual({
      type: 'MP4',
      mode: 0,
    })

    expect(
      buildRecordedStreamingRoute({
        recordedId: 301,
        videoFileId: 702,
        fileType: 'encoded',
        selection: { type: 'MP4', mode: 0 },
      }),
    ).toStrictEqual({
      ok: true,
      to: '/recorded/streaming/702?recordedId=301&streamingType=mp4&mode=0&fileType=encoded',
    })
    expect(
      buildRecordedStreamingRoute({
        recordedId: 301,
        videoFileId: 702,
        fileType: 'encoded',
        selection: null,
      }),
    ).toStrictEqual({
      ok: false,
      message: '配信設定が正しく入力されていません',
    })
    expect(
      buildRecordedStreamingRoute({
        recordedId: undefined,
        videoFileId: 702,
        fileType: 'encoded',
        selection: { type: 'MP4', mode: 0 },
      }),
    ).toStrictEqual({
      ok: false,
      message: '番組 ID が不正です',
    })
  })

  it('restores SendVideoFileSelectHostSetting with default/backfill and resolves stale hosts', () => {
    const storage = new Map<string, string>()
    const localStorageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }

    expect(readSendVideoFileSelectHostSetting(localStorageLike)).toStrictEqual({ hostName: null })
    storage.set('SendVideoFileSelectHostSetting', JSON.stringify({ hostName: 'kodi-two' }))
    expect(readSendVideoFileSelectHostSetting(localStorageLike)).toStrictEqual({
      hostName: 'kodi-two',
    })
    storage.set('SendVideoFileSelectHostSetting', JSON.stringify({ hostName: 10 }))
    expect(readSendVideoFileSelectHostSetting(localStorageLike)).toStrictEqual({ hostName: null })

    expect(
      resolveKodiHostName({ storedHostName: 'kodi-two', hosts: ['kodi-one', 'kodi-two'] }),
    ).toBe('kodi-two')
    expect(resolveKodiHostName({ storedHostName: 'stale', hosts: ['kodi-one'] })).toBe('kodi-one')
    expect(resolveKodiHostName({ storedHostName: null, hosts: [] })).toBeNull()

    writeSendVideoFileSelectHostSetting(localStorageLike, { hostName: 'kodi-one' })
    expect(JSON.parse(storage.get('SendVideoFileSelectHostSetting') ?? '{}')).toStrictEqual({
      hostName: 'kodi-one',
    })
  })
})
