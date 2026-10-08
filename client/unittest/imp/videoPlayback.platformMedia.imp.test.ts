import { describe, expect, it, vi } from 'vitest'
import { buildPlaybackMediaSource } from '@/features/video/playback/playbackMedia'
import {
  detectIPadPlatform,
  detectIPhonePlatform,
  detectMobilePlatform,
} from '@/features/video/playback/platformDetection'
import { setNavigatorPlatform } from './support/videoPlaybackFixtures'

describe('Video Playback platform detection implementation edges', () => {
  it('detects Android and iOS user agents as mobile platforms', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    })
    expect(detectMobilePlatform()).toBe(true)

    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    expect(detectMobilePlatform()).toBe(true)
  })

  it('detects touch Mac and coarse pointer devices without mobile user agents', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(detectMobilePlatform()).toBe(true)

    setNavigatorPlatform({
      maxTouchPoints: 1,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(pointer: coarse)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia,
    })

    expect(detectMobilePlatform()).toBe(true)
  })

  it('keeps desktop platforms false when no touch or mobile signal is present', () => {
    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    expect(detectMobilePlatform()).toBe(false)
  })
})

describe('detectIPhonePlatform (iPhone-only, excludes iPad)', () => {
  it('detects an iPhone user agent', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)',
    })

    expect(detectIPhonePlatform()).toBe(true)
  })

  it('excludes an iPad reporting a real "iPad" user agent', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'iPad',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    })

    expect(detectIPhonePlatform()).toBe(false)
  })

  it('excludes an iPad reporting a desktop-spoofed "Macintosh" + touch user agent', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    expect(detectIPhonePlatform()).toBe(false)
  })

  it('excludes non-Apple mobile and desktop user agents', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    })

    expect(detectIPhonePlatform()).toBe(false)
  })
})

describe('detectIPadPlatform (iPad-only, real UA or desktop-spoofed Mac + touch)', () => {
  it('detects a real "iPad" user agent', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'iPad',
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    })

    expect(detectIPadPlatform()).toBe(true)
  })

  it('detects an iPad reporting a desktop-spoofed "Macintosh" + touch user agent', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    expect(detectIPadPlatform()).toBe(true)
  })

  it('excludes iPhone', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)',
    })

    expect(detectIPadPlatform()).toBe(false)
  })

  it('excludes non-Apple mobile and desktop user agents', () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
    })

    expect(detectIPadPlatform()).toBe(false)

    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    expect(detectIPadPlatform()).toBe(false)
  })
})

describe('Video playback media source mapping', () => {
  it('maps recorded direct, recorded streaming, and live watch routes to API media source models', () => {
    expect(
      buildPlaybackMediaSource({
        route: {
          kind: 'recorded-direct',
          videoFileId: 701,
          recordedId: 301,
          shouldRenderInfoCard: true,
        },
        isHalfWidth: true,
      }),
    ).toStrictEqual({
      sourceKind: 'direct-video',
      mediaUrl: './api/videos/701',
    })

    expect(
      buildPlaybackMediaSource({
        route: {
          kind: 'recorded-streaming',
          videoFileId: 701,
          fileType: 'encoded',
          streamingType: 'mp4',
          mode: 0,
          recordedId: null,
          shouldRenderInfoCard: false,
        },
        isHalfWidth: true,
        seekSeconds: 15,
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: './api/streams/recorded/701/mp4?mode=0&ss=15',
    })

    expect(
      buildPlaybackMediaSource({
        route: {
          kind: 'live',
          channelId: 10,
          streamingType: 'm2tsll',
          mode: 0,
        },
        isHalfWidth: true,
        basePath: '/sub/api',
        baseUrl: 'https://epgstation.example',
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: 'https://epgstation.example/sub/api/streams/live/10/m2tsll?mode=0',
    })

    const m2tsllRoute = {
      kind: 'live',
      channelId: 10,
      streamingType: 'm2tsll',
      mode: 0,
    } as const
    expect(
      buildPlaybackMediaSource({
        route: m2tsllRoute,
        isHalfWidth: true,
        baseUrl: 'https://epgstation.example/sub/index.html?x=1#/onair/watch?type=m2tsll',
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: 'https://epgstation.example/sub/api/streams/live/10/m2tsll?mode=0',
    })
    expect(
      buildPlaybackMediaSource({
        route: m2tsllRoute,
        isHalfWidth: true,
        baseUrl: 'https://epgstation.example/',
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: 'https://epgstation.example/api/streams/live/10/m2tsll?mode=0',
    })
  })

  it('maps HLS routes to stream start and readiness request URLs without building playlist URLs early', () => {
    expect(
      buildPlaybackMediaSource({
        route: {
          kind: 'recorded-streaming',
          videoFileId: 701,
          fileType: 'ts',
          streamingType: 'hls',
          mode: 0,
          recordedId: 301,
          shouldRenderInfoCard: true,
        },
        isHalfWidth: false,
      }),
    ).toStrictEqual({
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/recorded/701/hls?mode=0&ss=0',
      readinessUrl: './api/streams?isHalfWidth=false',
    })
  })
})
