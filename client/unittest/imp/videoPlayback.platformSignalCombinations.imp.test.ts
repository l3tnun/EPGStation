import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectIPadPlatform,
  detectMobilePlatform,
} from '@/features/video/playback/platformDetection'
import { setNavigatorPlatform } from './support/videoPlaybackFixtures'

const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')

function setMatchMedia(value: unknown): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value })
}

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window, 'matchMedia')
  } else {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  }
})

describe('Video Playback platform detection signal combinations', () => {
  it('requires both the MacIntel platform and more than one touch point for a touch Mac', () => {
    setMatchMedia(vi.fn().mockReturnValue({ matches: false }))

    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'Win32', userAgent: desktopUserAgent })
    expect(detectMobilePlatform()).toBe(false)
    expect(detectIPadPlatform()).toBe(false)

    setNavigatorPlatform({ maxTouchPoints: 1, platform: 'MacIntel', userAgent: macUserAgent })
    expect(detectMobilePlatform()).toBe(false)
    expect(detectIPadPlatform()).toBe(false)

    setNavigatorPlatform({ maxTouchPoints: 0, platform: 'MacIntel', userAgent: macUserAgent })
    expect(detectMobilePlatform()).toBe(false)
    expect(detectIPadPlatform()).toBe(false)

    setNavigatorPlatform({ maxTouchPoints: 2, platform: 'MacIntel', userAgent: macUserAgent })
    expect(detectMobilePlatform()).toBe(true)
    expect(detectIPadPlatform()).toBe(true)
  })

  it('does not treat a touch device without a coarse pointer as mobile', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false })
    setMatchMedia(matchMedia)
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'Win32', userAgent: desktopUserAgent })

    expect(detectMobilePlatform()).toBe(false)
    expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('does not query the coarse pointer when no touch point exists', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    setMatchMedia(matchMedia)
    setNavigatorPlatform({ maxTouchPoints: 0, platform: 'Win32', userAgent: desktopUserAgent })

    expect(detectMobilePlatform()).toBe(false)
    expect(matchMedia).not.toHaveBeenCalled()
  })

  it('stays false when window.matchMedia is not a function', () => {
    setMatchMedia(undefined)
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'Win32', userAgent: desktopUserAgent })

    expect(detectMobilePlatform()).toBe(false)
  })

  it('stays false when window is not defined', () => {
    setNavigatorPlatform({ maxTouchPoints: 5, platform: 'Win32', userAgent: desktopUserAgent })
    vi.stubGlobal('window', undefined)

    expect(detectMobilePlatform()).toBe(false)
  })
})
