import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getEnabledBroadcastWaves,
  getIsRecordedEncodeEnabled,
  getRecordedDirectories,
  getRecordedDownloadUrlScheme,
  getRecordedEncodeModes,
  getRecordedKodiHosts,
  getRecordedViewUrlScheme,
  getStreamConfig,
  getUrlScheme,
  hasSocketIOPort,
  isIOSAddressBarFixTarget,
  resolveIOSAddressBarFixClass,
} from '@/app/lib/serverConfigSelectors'
import { APP_SHELL_DRAWER_TRANSITION_EASING } from '@/app/drawerLayout'

type Config = Parameters<typeof getRecordedEncodeModes>[0]

const loaded = (extra: Record<string, unknown> = {}) =>
  ({
    status: 'loaded',
    liveStreamEnabled: false,
    enabledBroadcastWaves: ['GR'],
    ...extra,
  }) as Config

function stubNavigator(userAgent: string, platform: string, maxTouchPoints: number) {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('iOS address bar fix target', () => {
  it('matches iPhone, iPad and iPod user agents and a touch-capable Mac platform only', () => {
    for (const device of ['iPhone', 'iPad', 'iPod']) {
      stubNavigator(`x ${device} x`, '', 0)
      expect(isIOSAddressBarFixTarget()).toBe(true)
      expect(resolveIOSAddressBarFixClass()).toBe('fix-address-bar2')
    }
    stubNavigator('x', 'MacIntel', 5)
    expect(isIOSAddressBarFixTarget()).toBe(true)
    stubNavigator('x', 'MacIntel', 1)
    expect(isIOSAddressBarFixTarget()).toBe(false)
    stubNavigator('x', 'MacIntel', 0)
    expect(isIOSAddressBarFixTarget()).toBe(false)
    stubNavigator('x', 'Win32', 5)
    expect(isIOSAddressBarFixTarget()).toBe(false)
    expect(resolveIOSAddressBarFixClass()).toBeNull()
  })

  it('does not match when there is no navigator', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isIOSAddressBarFixTarget()).toBe(false)
    expect(resolveIOSAddressBarFixClass()).toBeNull()
  })
})

describe('server config selectors', () => {
  it('detects a socket port only on a loaded config with a numeric port', () => {
    expect(hasSocketIOPort(loaded({ socketIOPort: 8889 }))).toBe(true)
    expect(hasSocketIOPort(loaded({ socketIOPort: '8889' }))).toBe(false)
    expect(hasSocketIOPort(loaded())).toBe(false)
    expect(hasSocketIOPort({ status: 'unloaded', socketIOPort: 8889 } as unknown as Config)).toBe(
      false,
    )
  })

  it.each([
    ['encodeModes', getRecordedEncodeModes],
    ['recordedDirectories', getRecordedDirectories],
    ['kodiHosts', getRecordedKodiHosts],
  ] as const)('returns the %s list only when it is an array', (key, select) => {
    expect(select(loaded({ [key]: ['a', 'b'] }))).toStrictEqual(['a', 'b'])
    expect(select(loaded({ [key]: 'a' }))).toStrictEqual([])
    expect(select(loaded())).toStrictEqual([])
    expect(select({ status: 'unloaded' })).toStrictEqual([])
  })

  it('treats encode as enabled only when the flag is true', () => {
    expect(getIsRecordedEncodeEnabled(loaded({ isEncodeEnabled: true }))).toBe(true)
    expect(getIsRecordedEncodeEnabled(loaded({ isEncodeEnabled: false }))).toBe(false)
    expect(getIsRecordedEncodeEnabled(loaded())).toBe(false)
  })

  it('falls back to the legacy four broadcast waves until the config is loaded', () => {
    expect(getEnabledBroadcastWaves({ status: 'unloaded' })).toStrictEqual([
      'GR',
      'BS',
      'CS',
      'SKY',
    ])
    expect(getEnabledBroadcastWaves(loaded({ enabledBroadcastWaves: ['BS4K'] }))).toStrictEqual([
      'BS4K',
    ])
  })

  it('returns the stream config and the url scheme only when the config has them', () => {
    const streamConfig = { live: { ts: { hls: ['x'] } } }
    const urlscheme = { video: { ios: 'v' } }

    expect(getStreamConfig(loaded({ streamConfig }))).toBe(streamConfig)
    expect(getStreamConfig(loaded())).toBeUndefined()
    expect(getUrlScheme(loaded({ urlscheme }))).toBe(urlscheme)
    expect(getUrlScheme(loaded())).toBeUndefined()
  })

  it('keeps the drawer easing curve of the legacy navigation drawer', () => {
    expect(APP_SHELL_DRAWER_TRANSITION_EASING).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
  })
})

describe('recorded url schemes', () => {
  const urlscheme = {
    video: { ios: 'view-ios', win: 'view-win' },
    download: { ios: 'download-ios' },
  }

  it('picks the scheme of the detected platform and null when there is none', () => {
    stubNavigator('x iPhone x', '', 0)
    expect(getRecordedViewUrlScheme(loaded({ urlscheme }))).toBe('view-ios')
    expect(getRecordedDownloadUrlScheme(loaded({ urlscheme }))).toBe('download-ios')

    stubNavigator('x Windows x', '', 0)
    expect(getRecordedViewUrlScheme(loaded({ urlscheme }))).toBe('view-win')
    expect(getRecordedDownloadUrlScheme(loaded({ urlscheme }))).toBeNull()

    stubNavigator('x Linux x', 'Linux', 0)
    expect(getRecordedViewUrlScheme(loaded({ urlscheme }))).toBeNull()
    expect(getRecordedDownloadUrlScheme(loaded({ urlscheme }))).toBeNull()
  })

  it('returns null when the config has no url scheme', () => {
    stubNavigator('x iPhone x', '', 0)
    expect(getRecordedViewUrlScheme(loaded())).toBeNull()
    expect(getRecordedDownloadUrlScheme(loaded())).toBeNull()
    expect(getRecordedViewUrlScheme(loaded({ urlscheme: undefined }))).toBeNull()
    expect(getRecordedDownloadUrlScheme(loaded({ urlscheme: undefined }))).toBeNull()
  })

  it('returns null without a navigator global', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Reflect.deleteProperty(globalThis, 'navigator')
    try {
      expect(getRecordedViewUrlScheme(loaded({ urlscheme }))).toBeNull()
      expect(getRecordedDownloadUrlScheme(loaded({ urlscheme }))).toBeNull()
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, 'navigator', descriptor)
      }
    }
  })
})
