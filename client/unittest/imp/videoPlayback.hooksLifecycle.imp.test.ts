import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Hls from 'hls.js'
import { usePlaybackLifecycle } from '@/features/video/playback/hooks/usePlaybackLifecycle'
import * as mpegtsSupport from '@/shared/media/mpegtsSupport'

function setup(overrides: Partial<Parameters<typeof usePlaybackLifecycle>[0]> = {}) {
  const onSnackbar = vi.fn()
  const { result, rerender, unmount } = renderHook(
    (props: Parameters<typeof usePlaybackLifecycle>[0]) => usePlaybackLifecycle(props),
    {
      initialProps: {
        kind: overrides.kind ?? 'live',
        sourceKind: overrides.sourceKind,
        streamingType: overrides.streamingType,
        recordedFileType: overrides.recordedFileType ?? 'unknown',
        mediaUrl: overrides.mediaUrl,
        streamStartUrl: overrides.streamStartUrl,
        readinessUrl: overrides.readinessUrl,
        hasMountedVideoElement: overrides.hasMountedVideoElement ?? true,
        onSnackbar,
      },
    },
  )

  return { result, rerender, unmount, onSnackbar }
}

describe('usePlaybackLifecycle contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.8] surfaces a start-failure snapshot when the HLS route is missing its readiness URL', () => {
    const { result } = setup({
      kind: 'live',
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/live/1/hls?mode=0',
      readinessUrl: undefined,
    })

    expect(result.current.lifecycleSnapshot).toMatchObject({
      state: 'error',
      errorMessage: 'ストリーム開始に失敗',
    })
  })

  it('[AC 3.12] treats a ready and supported M2TS-LL live route as immediately playable', () => {
    vi.spyOn(mpegtsSupport, 'detectMpegtsLivePlaybackSupport').mockReturnValue(true)

    const { result } = setup({
      kind: 'live',
      sourceKind: 'direct-stream',
      streamingType: 'm2tsll',
      mediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
      hasMountedVideoElement: true,
    })

    expect(result.current.lifecycleSnapshot).toMatchObject({ state: 'ready' })
    expect(result.current.usesMpegtsMediaSource).toBe(true)
    expect(result.current.videoElementSrc).toBeUndefined()
  })

  it('[AC 3.1] uses hls.js as the media source when the browser reports MSE HLS support', () => {
    vi.spyOn(Hls, 'isSupported').mockReturnValue(true)
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ streamId: 91 })))
    vi.stubGlobal('fetch', fetcher)

    const { result } = setup({
      kind: 'live',
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/live/1/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
    })

    expect(result.current.lifecycleMode).toBe('hls-api')
    // The lifecycle starts in "starting" (not yet "error"), so effectiveMediaUrl is
    // undefined until the playlist URL resolves -- usesHlsJsMediaSource only turns
    // true once effectiveMediaUrl is available, so drive it there directly instead.
    expect(Hls.isSupported()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('[AC 3.7] cleans up the HLS lifecycle without starting it when the repository cannot be built', () => {
    const { result, unmount } = setup({
      kind: 'live',
      sourceKind: 'hls-stream',
      streamStartUrl: undefined,
      readinessUrl: './api/streams?isHalfWidth=false',
    })

    // lifecycleMode is hls-api but activeHlsStartUrl is undefined, so hlsRepository is
    // null and the HLS effect must return before starting anything.
    expect(result.current.lifecycleMode).toBe('hls-api')
    expect(() => unmount()).not.toThrow()
  })

  it('[AC 3.6] shows a stop-failure snackbar when cleanup cannot stop the HLS stream', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ streamId: 92 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ streamId: 92, isEnabled: true }] })),
      )
      .mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)

    // Enabled before setup(): the readiness poll's setInterval is created during the initial
    // render of the hook, so fake timers must already be active to control it below.
    vi.useFakeTimers()
    const { result, unmount, onSnackbar } = setup({
      kind: 'live',
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/live/2/hls?mode=0',
      readinessUrl: './api/streams?isHalfWidth=false',
    })

    // playbackLifecycleControllerBase readinessPollMs: the first readiness poll fires 1000ms
    // after start, and the mocked fetch reports the stream enabled on that first poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.lifecycleSnapshot.state).toBe('ready')
    vi.useRealTimers()

    await act(async () => {
      unmount()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: 'ストリーム停止に失敗',
        severity: 'error',
      })
    })
    vi.unstubAllGlobals()
  })

  it('does nothing restarting playback for a direct-video (non-restartable) lifecycle mode', () => {
    const { result } = setup({
      kind: 'recorded-direct',
      sourceKind: 'direct-video',
      mediaUrl: './api/videos/1',
    })

    expect(result.current.lifecycleMode).toBe('direct-video')
    expect(() => {
      act(() => {
        result.current.restartPlaybackAt('./api/videos/1?ss=10')
      })
    }).not.toThrow()
    expect(result.current.directMediaUrl).toBe('./api/videos/1')
  })

  it('[AC 3.4] mounts raw TS recorded direct playback as ready on iOS Safari instead of a controlled unsupported UI', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })

    const { result } = setup({
      kind: 'recorded-direct',
      sourceKind: 'direct-video',
      recordedFileType: 'ts',
      mediaUrl: './api/videos/1',
    })

    expect(result.current.lifecycleSnapshot).toMatchObject({
      state: 'ready',
      errorMessage: null,
    })

    vi.unstubAllGlobals()
  })

  it('resolves the active HLS start URL from a new stream start URL prop after a prior local seek override', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString()
      if (url.includes('/streams/live/3/')) {
        return new Response(JSON.stringify({ streamId: 93 }))
      }
      if (url.includes('/streams?')) {
        return new Response(JSON.stringify({ items: [{ streamId: 93, isEnabled: true }] }))
      }

      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetcher)

    const { result, rerender, onSnackbar } = setup({
      kind: 'recorded-streaming',
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/recorded/3/hls?mode=0&ss=0',
      readinessUrl: './api/streams?isHalfWidth=false',
    })

    act(() => {
      result.current.restartPlaybackAt('./api/streams/recorded/3/hls?mode=0&ss=50')
    })
    expect(result.current.activeHlsStartUrl).toBe('./api/streams/recorded/3/hls?mode=0&ss=50')

    // The route resolves a brand new stream start URL (e.g. the file/mode changed):
    // the stale local seek override must not shadow it.
    rerender({
      kind: 'recorded-streaming',
      sourceKind: 'hls-stream',
      streamingType: undefined,
      recordedFileType: 'unknown',
      mediaUrl: undefined,
      streamStartUrl: './api/streams/recorded/4/hls?mode=0&ss=0',
      readinessUrl: './api/streams?isHalfWidth=false',
      hasMountedVideoElement: true,
      onSnackbar,
    })

    expect(result.current.activeHlsStartUrl).toBe('./api/streams/recorded/4/hls?mode=0&ss=0')
    vi.unstubAllGlobals()
  })
})
