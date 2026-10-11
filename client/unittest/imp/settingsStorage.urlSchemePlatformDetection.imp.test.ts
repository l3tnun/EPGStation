import { describe, expect, it } from 'vitest'
import {
  detectBrowserUrlSchemePlatform,
  detectNavigatorUrlSchemePlatform,
} from '@/shared/settings/urlSchemePlatform'
import { AdjacentStorageRegistry } from '@/shared/settings'

const detect = (userAgent: string, platform: string, maxTouchPoints = 0) =>
  detectBrowserUrlSchemePlatform({ userAgent, platform, maxTouchPoints })

describe('URL scheme platform detection', () => {
  it('detects iOS from the user agent and Android regardless of case', () => {
    expect(detect('x iPhone x', '')).toBe('ios')
    expect(detect('x iPad x', '')).toBe('ios')
    expect(detect('x iPod x', '')).toBe('ios')
    expect(detect('x android x', '')).toBe('android')
  })

  it('treats a Mac platform with more than one touch point as iOS and with one or none as mac', () => {
    expect(detect('', 'MacIntel', 2)).toBe('ios')
    expect(detect('', 'MacIntel', 1)).toBe('mac')
    expect(detect('', 'MacIntel', 0)).toBe('mac')
  })

  it('detects mac from either the user agent or the platform alone', () => {
    expect(detect('x Macintosh x', '')).toBe('mac')
    expect(detect('', 'MacIntel')).toBe('mac')
  })

  it('detects win from either the user agent or the platform alone, and nothing else as null', () => {
    expect(detect('x Windows x', '')).toBe('win')
    expect(detect('', 'Win32')).toBe('win')
    expect(detect('x Linux x', 'Linux x86_64')).toBeNull()
  })

  it('detects from a navigator-like object and returns null when there is none', () => {
    expect(
      detectNavigatorUrlSchemePlatform({ userAgent: 'x Android x', platform: '', maxTouchPoints: 0 }),
    ).toBe('android')
    expect(detectNavigatorUrlSchemePlatform(undefined)).toBeNull()
  })
})

describe('Adjacent storage definitions', () => {
  it('lists every adjacent storage key with its owner and default value in order', () => {
    expect(new AdjacentStorageRegistry().list()).toStrictEqual([
      {
        key: 'OnAirSelectStreamSetting',
        owner: 'frontend-onair',
        defaultValue: { useURLScheme: false, type: 'M2TS', mode: 0 },
      },
      {
        key: 'RecordedSelectStreamSetting',
        owner: 'frontend-recorded',
        defaultValue: { type: 'WebM', mode: 0 },
      },
      {
        key: 'SendVideoFileSelectHostSetting',
        owner: 'frontend-recorded',
        defaultValue: { hostName: null },
      },
      {
        key: 'VideoPlayerSetting',
        owner: 'frontend-video-playback',
        defaultValue: { isShowSubtitle: false },
      },
      { key: 'GuideSizeSetting', owner: 'frontend-guide', defaultValue: null },
      { key: 'GuideGenreSetting', owner: 'frontend-guide', defaultValue: null },
      {
        key: 'GuideProgramDetailSetting',
        owner: 'frontend-guide',
        defaultValue: { encode: 'TS', isDeleteOriginalAfterEncode: false },
      },
      {
        key: 'AddEncodeSeting',
        owner: 'frontend-recorded',
        defaultValue: {
          encodeMode: null,
          parentDirectory: null,
          isSaveSameDirectory: false,
          removeOriginal: false,
        },
      },
    ])
  })
})
