import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackSubtitles } from '@/features/video/playback/hooks/usePlaybackSubtitles'
import type { PlaybackSubtitleAdapter } from '@/features/video/playback/playbackSubtitle'
import type {
  HlsLifecycleState,
  PlaybackLifecycleMode,
} from '@/features/video/playback/playbackLifecycle'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function makeFakeTextTrackList(entries: TextTrack[] = []) {
  const target = new EventTarget()
  return Object.assign(target, {
    length: entries.length,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }) as unknown as TextTrackList
}

function setup(
  overrides: {
    videoRef?: MutableRefObject<HTMLVideoElement | null>
    subtitleAdapterRef?: MutableRefObject<PlaybackSubtitleAdapter | null>
    effectiveMediaUrl?: string
    isForceEnableSubtitleStroke?: boolean
    isSubtitleRendererMounted?: boolean
    lifecycleMode?: PlaybackLifecycleMode
    lifecycleState?: HlsLifecycleState
  } = {},
) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const subtitleAdapterRef =
    overrides.subtitleAdapterRef ?? ref<PlaybackSubtitleAdapter | null>(null)

  const { result, rerender, unmount } = renderHook(
    (props: { lifecycleState: HlsLifecycleState; isSubtitleRendererMounted: boolean }) =>
      usePlaybackSubtitles({
        videoRef,
        subtitleAdapterRef,
        effectiveMediaUrl: overrides.effectiveMediaUrl,
        isForceEnableSubtitleStroke: overrides.isForceEnableSubtitleStroke ?? false,
        isSubtitleRendererMounted: props.isSubtitleRendererMounted,
        lifecycleMode: overrides.lifecycleMode ?? 'direct-video',
        lifecycleState: props.lifecycleState,
      }),
    {
      initialProps: {
        lifecycleState: overrides.lifecycleState ?? 'idle',
        isSubtitleRendererMounted: overrides.isSubtitleRendererMounted ?? false,
      },
    },
  )

  return { result, rerender, unmount, videoRef, subtitleAdapterRef }
}

describe('usePlaybackSubtitles contract', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('reports no available subtitle track without a mounted video element', () => {
    const { result } = setup()

    act(() => {
      result.current.updateSubtitleTrackAvailability()
    })

    expect(result.current.subtitleAdapterState).toStrictEqual({ available: false, kind: 'none' })
  })

  it('[AC 4.12] reports track availability from a native text track adapter', () => {
    const video = document.createElement('video')
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: { 0: track, length: 1 },
    })
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'native-text-track',
      setVisible: () => undefined,
      pushID3v2Data: () => undefined,
      pushMpegtsPrivateData: () => undefined,
      dispose: () => undefined,
    }
    const { result } = setup({
      videoRef: ref(video),
      subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter),
    })

    act(() => {
      result.current.updateSubtitleTrackAvailability()
    })

    expect(result.current.subtitleAdapterState).toStrictEqual({
      available: true,
      kind: 'native-text-track',
    })
  })

  it('[AC 4.12] reports no available track when the native adapter has no text tracks', () => {
    const video = document.createElement('video')
    Object.defineProperty(video, 'textTracks', { configurable: true, value: { length: 0 } })
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'native-text-track',
      setVisible: () => undefined,
      pushID3v2Data: () => undefined,
      pushMpegtsPrivateData: () => undefined,
      dispose: () => undefined,
    }
    const { result } = setup({
      videoRef: ref(video),
      subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter),
    })

    act(() => {
      result.current.updateSubtitleTrackAvailability()
    })

    expect(result.current.subtitleAdapterState).toStrictEqual({ available: false, kind: 'none' })
  })

  it('disposes an active subtitle adapter and reports unavailable when there is no video element', () => {
    const dispose = vi.fn()
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'aribb24',
      setVisible: () => undefined,
      pushID3v2Data: () => undefined,
      pushMpegtsPrivateData: () => undefined,
      dispose,
    }
    const { result } = setup({ subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter) })

    expect(dispose).toHaveBeenCalled()
    expect(result.current.subtitleAdapterState).toStrictEqual({ available: false, kind: 'none' })
  })

  it('disposes an active subtitle adapter and reports unavailable once the lifecycle enters error state', () => {
    const video = document.createElement('video')
    const dispose = vi.fn()
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'aribb24',
      setVisible: () => undefined,
      pushID3v2Data: () => undefined,
      pushMpegtsPrivateData: () => undefined,
      dispose,
    }
    const { rerender } = setup({
      videoRef: ref(video),
      subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter),
      lifecycleState: 'ready',
    })

    rerender({ lifecycleState: 'error', isSubtitleRendererMounted: false })

    expect(dispose).toHaveBeenCalled()
  })

  it('[AC 4.4] mounts an aribb24 renderer with the saved subtitle visibility and stroke setting', () => {
    localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    const video = document.createElement('video')
    document.body.appendChild(video)

    const { result } = setup({
      videoRef: ref(video),
      isSubtitleRendererMounted: true,
      isForceEnableSubtitleStroke: true,
      lifecycleState: 'ready',
    })

    expect(result.current.subtitleAdapterState.kind).toBe('aribb24')
    expect(result.current.subtitleSetting).toStrictEqual({ isShowSubtitle: true })
    video.remove()
  })

  it('[AC 4.4] toggles the subtitle setting, persists it, and forwards visibility to the mounted adapter', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const { result } = setup({
      videoRef: ref(video),
      isSubtitleRendererMounted: true,
      lifecycleState: 'ready',
    })
    expect(result.current.subtitleSetting.isShowSubtitle).toBe(false)

    act(() => {
      result.current.toggleSubtitle()
    })

    expect(result.current.subtitleSetting.isShowSubtitle).toBe(true)
    expect(JSON.parse(localStorage.getItem('VideoPlayerSetting') ?? '{}')).toStrictEqual({
      isShowSubtitle: true,
    })
    video.remove()
  })

  it('reinstalls the subtitle adapter and updates track availability on a native addtrack event', () => {
    const video = document.createElement('video')
    const trackList = makeFakeTextTrackList()
    Object.defineProperty(video, 'textTracks', { configurable: true, value: trackList })

    const { result } = setup({ videoRef: ref(video), isSubtitleRendererMounted: false })
    expect(result.current.subtitleAdapterState).toStrictEqual({ available: false, kind: 'none' })

    // Simulate a text track becoming available after the media element mounts.
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: Object.assign(trackList, { 0: track, length: 1 }),
    })

    act(() => {
      trackList.dispatchEvent(new Event('addtrack'))
    })

    expect(result.current.subtitleAdapterState).toStrictEqual({
      available: true,
      kind: 'native-text-track',
    })
  })

  it('reinstalls the subtitle adapter on a native texttrack change event', () => {
    const video = document.createElement('video')
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    const trackList = makeFakeTextTrackList()
    Object.assign(trackList, { 0: track, length: 1 })
    Object.defineProperty(video, 'textTracks', { configurable: true, value: trackList })

    const { result } = setup({ videoRef: ref(video), isSubtitleRendererMounted: false })
    expect(result.current.subtitleAdapterState.kind).toBe('native-text-track')

    act(() => {
      trackList.dispatchEvent(new Event('change'))
    })

    expect(result.current.subtitleAdapterState.kind).toBe('native-text-track')
  })

  it('does not attach native text track listeners while an aribb24 renderer is mounted', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const trackList = makeFakeTextTrackList()
    const addEventListener = vi.spyOn(trackList, 'addEventListener')
    Object.defineProperty(video, 'textTracks', { configurable: true, value: trackList })

    setup({ videoRef: ref(video), isSubtitleRendererMounted: true, lifecycleState: 'ready' })

    expect(addEventListener).not.toHaveBeenCalled()
    video.remove()
  })

  it('removes native text track listeners and disposes the adapter on unmount', () => {
    const video = document.createElement('video')
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    const trackList = makeFakeTextTrackList()
    Object.assign(trackList, { 0: track, length: 1 })
    Object.defineProperty(video, 'textTracks', { configurable: true, value: trackList })
    const removeEventListener = vi.spyOn(trackList, 'removeEventListener')

    const { unmount } = setup({ videoRef: ref(video), isSubtitleRendererMounted: false })

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('addtrack', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
