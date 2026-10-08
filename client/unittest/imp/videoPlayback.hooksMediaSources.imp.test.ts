import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Hls from 'hls.js'
import { usePlaybackMediaSources } from '@/features/video/playback/hooks/usePlaybackMediaSources'
import type { PlaybackSubtitleAdapter } from '@/features/video/playback/playbackSubtitle'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

function setup(overrides: {
  videoRef?: MutableRefObject<HTMLVideoElement | null>
  subtitleAdapterRef?: MutableRefObject<PlaybackSubtitleAdapter | null>
  effectiveMediaUrl?: string
  usesHlsJsMediaSource?: boolean
  usesMpegtsMediaSource?: boolean
}) {
  const videoRef = overrides.videoRef ?? ref<HTMLVideoElement | null>(null)
  const subtitleAdapterRef =
    overrides.subtitleAdapterRef ?? ref<PlaybackSubtitleAdapter | null>(null)

  const { result, rerender, unmount } = renderHook(
    (props: {
      effectiveMediaUrl?: string
      usesHlsJsMediaSource: boolean
      usesMpegtsMediaSource: boolean
    }) =>
      usePlaybackMediaSources({
        videoRef,
        subtitleAdapterRef,
        effectiveMediaUrl: props.effectiveMediaUrl,
        usesHlsJsMediaSource: props.usesHlsJsMediaSource,
        usesMpegtsMediaSource: props.usesMpegtsMediaSource,
      }),
    {
      initialProps: {
        effectiveMediaUrl: overrides.effectiveMediaUrl,
        usesHlsJsMediaSource: overrides.usesHlsJsMediaSource ?? false,
        usesMpegtsMediaSource: overrides.usesMpegtsMediaSource ?? false,
      },
    },
  )

  return { result, rerender, unmount, videoRef, subtitleAdapterRef }
}

describe('usePlaybackMediaSources HLS contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when HLS media source is not requested', () => {
    const video = document.createElement('video')
    expect(() => {
      setup({ videoRef: ref(video), effectiveMediaUrl: './x.m3u8', usesHlsJsMediaSource: false })
    }).not.toThrow()
  })

  it('does nothing when the HLS media source is requested without a mounted video element', () => {
    expect(() => {
      setup({ effectiveMediaUrl: './x.m3u8', usesHlsJsMediaSource: true })
    }).not.toThrow()
  })

  it('does nothing when the HLS media source is requested without a resolved media URL', () => {
    const video = document.createElement('video')
    expect(() => {
      setup({ videoRef: ref(video), usesHlsJsMediaSource: true })
    }).not.toThrow()
  })

  it('[AC 3.1] attaches a real hls.js player to the video element, loads the source, and autoplays on manifest parsed', async () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const play = vi.fn(async () => undefined)
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const attachMedia = vi.spyOn(Hls.prototype, 'attachMedia')
    const loadSource = vi.spyOn(Hls.prototype, 'loadSource')

    const { unmount } = setup({
      videoRef: ref(video),
      effectiveMediaUrl: './streamfiles/stream1.m3u8',
      usesHlsJsMediaSource: true,
    })

    expect(attachMedia).toHaveBeenCalledWith(video)
    expect(loadSource).toHaveBeenCalledWith('./streamfiles/stream1.m3u8')

    const hls = attachMedia.mock.instances[0] as Hls
    await act(async () => {
      hls.trigger(Hls.Events.MANIFEST_PARSED, {
        levels: [],
        firstLevel: 0,
        audioTracks: [],
        subtitleTracks: [],
        stats: {},
      } as never)
      await Promise.resolve()
    })

    expect(play).toHaveBeenCalled()

    const destroy = vi.spyOn(hls, 'destroy')
    unmount()
    expect(destroy).toHaveBeenCalled()
    video.remove()
  })

  it('[AC 3.6] logs (does not throw) when the autoplay after HLS manifest parsed rejects', async () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const play = vi.fn(async () => {
      throw new Error('synthetic play failure')
    })
    Object.defineProperty(video, 'play', { configurable: true, value: play })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const attachMedia = vi.spyOn(Hls.prototype, 'attachMedia')

    setup({
      videoRef: ref(video),
      effectiveMediaUrl: './streamfiles/stream2.m3u8',
      usesHlsJsMediaSource: true,
    })

    const hls = attachMedia.mock.instances[0] as Hls
    await act(async () => {
      hls.trigger(Hls.Events.MANIFEST_PARSED, {
        levels: [],
        firstLevel: 0,
        audioTracks: [],
        subtitleTracks: [],
        stats: {},
      } as never)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(warn).toHaveBeenCalledWith('video.play() failed', expect.any(Error))
    video.remove()
  })

  it('[AC 4.1] bridges hls.js ID3 metadata frames into the active subtitle adapter', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const pushID3v2Data = vi.fn()
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'aribb24',
      setVisible: () => undefined,
      pushID3v2Data,
      pushMpegtsPrivateData: () => undefined,
      dispose: () => undefined,
    }
    // hls.js 自身も同じ event を購読し、その handler は video 要素の TextTrack を操作する。
    // jsdom の TextTrack はその形を満たさず例外になり、hls.js の trigger は handler の例外を
    // 握り潰すため、後続の handler へ配送されない。実ブラウザでは起きない事情なので、配送経路
    // ではなく、この hook が張った handler そのものを掴んで呼ぶ。hls.js 内部は購読時に context を
    // 渡す（3 引数）が、この hook は渡さない（2 引数）。
    const subscribe = vi.spyOn(Hls.prototype, 'on')

    setup({
      videoRef: ref(video),
      subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter),
      effectiveMediaUrl: './streamfiles/stream3.m3u8',
      usesHlsJsMediaSource: true,
    })

    const sample = { pts: 5, data: new Uint8Array([1, 2, 3]) }
    const bridged = subscribe.mock.calls.filter(
      (call) => call[0] === Hls.Events.FRAG_PARSING_METADATA && call.length === 2,
    )
    expect(bridged).toHaveLength(1)
    act(() => {
      const handler = bridged[0][1] as (event: string, data: unknown) => void
      handler(Hls.Events.FRAG_PARSING_METADATA, { samples: [sample] })
    })

    expect(pushID3v2Data).toHaveBeenCalledWith(5, sample.data)
    video.remove()
  })

  it('ignores an hls.js ID3 metadata frame while no subtitle adapter is mounted', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const attachMedia = vi.spyOn(Hls.prototype, 'attachMedia')

    setup({
      videoRef: ref(video),
      subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(null),
      effectiveMediaUrl: './streamfiles/stream3b.m3u8',
      usesHlsJsMediaSource: true,
    })

    const hls = attachMedia.mock.instances[0] as Hls
    expect(() => {
      act(() => {
        hls.trigger(Hls.Events.FRAG_PARSING_METADATA, {
          samples: [{ pts: 5, data: new Uint8Array([1]) }],
        } as never)
      })
    }).not.toThrow()
    video.remove()
  })

  it('destroys the previous HLS player and creates a new one when the media URL changes', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const attachMedia = vi.spyOn(Hls.prototype, 'attachMedia')

    const { rerender } = setup({
      videoRef: ref(video),
      effectiveMediaUrl: './streamfiles/stream4.m3u8',
      usesHlsJsMediaSource: true,
    })

    const firstHls = attachMedia.mock.instances[0] as Hls
    const destroy = vi.spyOn(firstHls, 'destroy')

    rerender({
      effectiveMediaUrl: './streamfiles/stream5.m3u8',
      usesHlsJsMediaSource: true,
      usesMpegtsMediaSource: false,
    })

    expect(destroy).toHaveBeenCalled()
    expect(attachMedia).toHaveBeenCalledTimes(2)
    video.remove()
  })

  it('destroys an existing HLS player once the media URL becomes unavailable', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const attachMedia = vi.spyOn(Hls.prototype, 'attachMedia')

    const { rerender } = setup({
      videoRef: ref(video),
      effectiveMediaUrl: './streamfiles/stream6.m3u8',
      usesHlsJsMediaSource: true,
    })

    const hls = attachMedia.mock.instances[0] as Hls
    const destroy = vi.spyOn(hls, 'destroy')

    rerender({
      effectiveMediaUrl: undefined,
      usesHlsJsMediaSource: true,
      usesMpegtsMediaSource: false,
    })

    expect(destroy).toHaveBeenCalled()
    video.remove()
  })
})
