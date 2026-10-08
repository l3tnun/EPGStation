import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectOrientationLockSupport,
  detectPictureInPictureEnabled,
  getLockableOrientation,
  getVideoPlayerStorage,
  isInteractiveShortcutTarget,
  readSeekSeconds,
} from '@/features/video/playback/lib/playbackShellSupport'
import {
  detectIPadPlatform,
  detectIPhonePlatform,
  detectMobilePlatform,
} from '@/features/video/playback/platformDetection'
import {
  clampPlaybackSeek,
  formatPlaybackTime,
  resolvePlaybackControlVisibility,
} from '@/features/video/playback/playbackControls'
import {
  readVideoPlayerSetting,
  saveVideoPlayerSetting,
} from '@/features/video/playback/playbackSettings'
import { detectM2tsLlSupport } from '@/features/video/playback/playbackLifecycle'
import { createFetchHlsLifecycleRepository } from '@/features/video/playback/playbackLifecycleRepository'

describe('Video Playback pure helper contract edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports orientation lock support only when the browser exposes screen.orientation.lock', () => {
    const originalOrientation = Object.getOwnPropertyDescriptor(screen, 'orientation')
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: { type: 'portrait-primary' },
    })
    expect(getLockableOrientation()).toStrictEqual({ type: 'portrait-primary' })
    expect(detectOrientationLockSupport()).toBe(false)

    if (originalOrientation !== undefined) {
      Object.defineProperty(screen, 'orientation', originalOrientation)
    }
  })

  it('[AC 3.14] reads the ss query parameter as the base seek offset for HLS/direct URLs', () => {
    expect(readSeekSeconds('./api/streams/recorded/701/webm?mode=0')).toBe(0)
    expect(readSeekSeconds('./api/streams/recorded/701/webm?mode=0&ss=-5')).toBe(0)
    expect(readSeekSeconds('./api/streams/recorded/701/webm?mode=0&ss=42')).toBe(42)
  })

  it('treats a missing document as Picture-in-Picture unavailable', () => {
    vi.stubGlobal('document', undefined)
    expect(detectPictureInPictureEnabled()).toBe(false)
  })

  it('treats a missing window as having no available video player storage', () => {
    vi.stubGlobal('window', undefined)
    expect(getVideoPlayerStorage()).toBeUndefined()
  })

  it('reports Picture-in-Picture availability from document.pictureInPictureEnabled', () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    expect(detectPictureInPictureEnabled()).toBe(true)

    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: false,
    })
    expect(detectPictureInPictureEnabled()).toBe(false)
  })

  it('falls back to document.pictureInPictureEnabled when the video has no webkitSupportsPresentationMode', () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    const video = document.createElement('video')

    expect(detectPictureInPictureEnabled(video)).toBe(true)
    expect(detectPictureInPictureEnabled(null)).toBe(true)
    expect(detectPictureInPictureEnabled(undefined)).toBe(true)
  })

  it('[AC 13a] prefers webkitSupportsPresentationMode over document.pictureInPictureEnabled when the video has it', () => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: true,
    })
    const video = document.createElement('video')
    const webkitSupportsPresentationMode = vi.fn(() => false)
    Object.defineProperty(video, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: webkitSupportsPresentationMode,
    })

    // Before loadedmetadata, webkitSupportsPresentationMode reports false on WebKit even in a
    // Safari tab where PiP genuinely works once the video is ready (iPad Simulator, iPadOS 26.5,
    // confirmed). Callers must trust this over document.pictureInPictureEnabled=true.
    expect(detectPictureInPictureEnabled(video)).toBe(false)
    expect(webkitSupportsPresentationMode).toHaveBeenCalledWith('picture-in-picture')

    // After loadedmetadata (videoWidth known), it flips true in a real Safari tab.
    webkitSupportsPresentationMode.mockReturnValue(true)
    expect(detectPictureInPictureEnabled(video)).toBe(true)

    // WebKit Bugzilla #303885 (iOS/iPadOS standalone PWA): document.pictureInPictureEnabled
    // incorrectly reports true, but webkitSupportsPresentationMode correctly reports false.
    webkitSupportsPresentationMode.mockReturnValue(false)
    expect(detectPictureInPictureEnabled(video)).toBe(false)
  })

  it('falls back to undefined storage when localStorage access throws (private mode)', () => {
    expect(getVideoPlayerStorage()).toBe(window.localStorage)

    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })

    expect(getVideoPlayerStorage()).toBeUndefined()

    if (originalDescriptor !== undefined) {
      Object.defineProperty(window, 'localStorage', originalDescriptor)
    }
  })

  it('treats non-HTMLElement event targets as non-interactive shortcut targets', () => {
    expect(isInteractiveShortcutTarget(null)).toBe(false)
    expect(isInteractiveShortcutTarget({} as EventTarget)).toBe(false)
    const button = document.createElement('button')
    expect(isInteractiveShortcutTarget(button)).toBe(true)
  })

  it('treats a missing navigator as a non-mobile platform', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectMobilePlatform()).toBe(false)
  })

  it('treats a missing navigator as excluded from the iPhone platform', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectIPhonePlatform()).toBe(false)
  })

  it('treats a missing navigator as excluded from the iPad platform', () => {
    vi.stubGlobal('navigator', undefined)
    expect(detectIPadPlatform()).toBe(false)
  })

  it('[AC 4.10] formats hour-scale durations with an HH:MM:SS time display', () => {
    expect(formatPlaybackTime(-5)).toBe('00:00')
    expect(formatPlaybackTime(65)).toBe('01:05')
    expect(formatPlaybackTime(3725)).toBe('01:02:05')
  })

  it('[AC 4.5] hides the volume slider on mobile/iPadOS and narrow viewports without hiding the volume button', () => {
    const mobileNarrow = resolvePlaybackControlVisibility({
      duration: 0,
      viewportWidth: 400,
      isMobilePlatform: true,
      canLockOrientation: false,
      isPictureInPictureEnabled: false,
      hasSubtitleTrack: false,
    })
    expect(mobileNarrow.showVolumeSlider).toBe(false)
    expect(mobileNarrow.showBottomPlayButton).toBe(false)
    expect(mobileNarrow.timeDisplay).toBe('--:--/--:--')
  })

  it('[AC 4.12] shows the subtitle button on a narrow viewport once duration is known', () => {
    const visibility = resolvePlaybackControlVisibility({
      duration: 120,
      currentTime: 30,
      viewportWidth: 400,
      isMobilePlatform: false,
      canLockOrientation: false,
      isPictureInPictureEnabled: false,
      hasSubtitleTrack: true,
    })
    expect(visibility.showSubtitleButton).toBe(true)
    expect(visibility.showSeekBar).toBe(true)
    expect(visibility.timeDisplay).toBe('00:30/02:00')
  })

  it('[AC 4.10] [AC 4.14] hides fast seek/speed controls and disables seek during live playback even when duration is finite and positive', () => {
    const live = resolvePlaybackControlVisibility({
      duration: 600,
      currentTime: 30,
      isLive: true,
      viewportWidth: 1440,
      isMobilePlatform: false,
      canLockOrientation: false,
      isPictureInPictureEnabled: false,
      hasSubtitleTrack: false,
    })
    expect(live.canSeek).toBe(false)
    expect(live.showFastSeekControls).toBe(false)
    expect(live.showSpeedControls).toBe(false)
    expect(live.timeDisplay).toBe('--:--/--:--')

    const recorded = resolvePlaybackControlVisibility({
      duration: 600,
      currentTime: 30,
      isLive: false,
      viewportWidth: 1440,
      isMobilePlatform: false,
      canLockOrientation: false,
      isPictureInPictureEnabled: false,
      hasSubtitleTrack: false,
    })
    expect(recorded.canSeek).toBe(true)
    expect(recorded.showFastSeekControls).toBe(true)
    expect(recorded.showSpeedControls).toBe(true)
  })

  it('[AC 4.14] clamps out-of-range seek deltas to zero when duration is unknown', () => {
    expect(clampPlaybackSeek({ currentTime: 10, deltaSeconds: 30, duration: 0 })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 10, deltaSeconds: -30, duration: 100 })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 90, deltaSeconds: 30, duration: 100 })).toBe(100)
  })

  it('discards a malformed stored VideoPlayerSetting payload', () => {
    const storage = new Map<string, string>()
    const adapter: Storage = {
      get length() {
        return storage.size
      },
      clear: vi.fn(() => storage.clear()),
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
    }

    storage.set('VideoPlayerSetting', '{"isShowSubtitle":"not-a-boolean"}')
    expect(readVideoPlayerSetting(adapter)).toStrictEqual({ isShowSubtitle: false })

    storage.set('VideoPlayerSetting', 'not-json{')
    expect(readVideoPlayerSetting(adapter)).toStrictEqual({ isShowSubtitle: false })
  })

  it('returns false without writing when storage is unavailable', () => {
    expect(readVideoPlayerSetting(undefined)).toStrictEqual({ isShowSubtitle: false })
    expect(saveVideoPlayerSetting(undefined, { isShowSubtitle: true })).toBe(false)

    const throwingStorage: Storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError')
      }),
    }
    expect(saveVideoPlayerSetting(throwingStorage, { isShowSubtitle: true })).toBe(false)
  })

  it('[AC 3.12] uses the real mpegts.js module by default for M2TS-LL support detection', () => {
    expect(() => detectM2tsLlSupport()).not.toThrow()
  })

  it('propagates HLS start/keep/stop HTTP failures as thrown errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    const repository = createFetchHlsLifecycleRepository({
      streamStartUrl: './api/streams/live/10/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      fetcher,
    })

    await expect(repository.start()).rejects.toThrow('HLS stream start failed')
    await expect(repository.fetchStreams()).rejects.toThrow('HLS stream readiness failed')
    await expect(repository.keep(81)).rejects.toThrow('HLS stream keep failed')
  })

  it('propagates HLS stop HTTP failures and skips unrecognized readiness entries', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ isEnabled: true }, { streamId: null }] })),
      )
    const repository = createFetchHlsLifecycleRepository({
      streamStartUrl: './api/streams/live/10/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      fetcher,
    })

    await expect(repository.stop(81)).rejects.toThrow('HLS stream stop failed')
    await expect(repository.fetchStreams()).resolves.toStrictEqual([])
  })

  it('falls back to ./api when the stream start URL begins with /streams/', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 }))
    const repository = createFetchHlsLifecycleRepository({
      streamStartUrl: '/streams/live/10/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      fetcher,
    })

    await expect(repository.keep(81)).rejects.toThrow('HLS stream keep failed')
    expect(fetcher).toHaveBeenCalledWith('./api/streams/81/keep', { method: 'PUT' })
  })

  it('treats a readiness response that is neither an array nor a record with an items array as empty', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(null)))
    const repository = createFetchHlsLifecycleRepository({
      streamStartUrl: './api/streams/live/10/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      fetcher,
    })

    await expect(repository.fetchStreams()).resolves.toStrictEqual([])
  })
})
