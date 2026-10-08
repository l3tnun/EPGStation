import type { MutableRefObject } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Mpegts from 'mpegts.js'
import { usePlaybackMediaSources } from '@/features/video/playback/hooks/usePlaybackMediaSources'
import type { PlaybackSubtitleAdapter } from '@/features/video/playback/playbackSubtitle'

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value }
}

/**
 * mpegts.js's MSE mode requires a `window.MediaSource` implementation, which jsdom does
 * not provide. This is a media/MSE stub, not a mock of the code under test: it supplies
 * just enough of the browser MediaSource contract for the real mpegts.js player to
 * construct, attach to a <video>, and tear down without touching real segment data.
 */
class FakeMediaSource extends EventTarget {
  static isTypeSupported(): boolean {
    return true
  }

  readyState = 'closed'
  duration = Number.NaN
  addSourceBuffer() {
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      appendBuffer: () => undefined,
      remove: () => undefined,
      updating: false,
    }
  }
  removeSourceBuffer() {
    return undefined
  }
  endOfStream() {
    return undefined
  }
}

function withMseStub<T>(run: () => T): T {
  vi.stubGlobal('MediaSource', FakeMediaSource)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  })
  try {
    return run()
  } finally {
    vi.unstubAllGlobals()
  }
}

/**
 * Apple's ManagedMediaSource, the MSE variant iOS Safari 17.1+ exposes instead of (or
 * alongside) `window.MediaSource`. jsdom does not provide it either, so -- like
 * `FakeMediaSource` above -- this is a media/MSE stub, not a mock of the code under test:
 * it supplies just enough of the ManagedMediaSource contract for mpegts.js's real
 * MSEController to detect it (`typeof self.ManagedMediaSource === 'function' &&
 * !(typeof self.MediaSource === 'function')`), construct it, and attach it via
 * `video.srcObject` instead of `video.src`.
 */
class FakeManagedMediaSource extends EventTarget {
  static isTypeSupported(): boolean {
    return true
  }

  readyState = 'closed'
  duration = Number.NaN
  addSourceBuffer() {
    return {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      appendBuffer: () => undefined,
      remove: () => undefined,
      updating: false,
    }
  }
  removeSourceBuffer() {
    return undefined
  }
  endOfStream() {
    return undefined
  }
}

function withManagedMediaSourceStub<T>(run: () => T): T {
  vi.stubGlobal('MediaSource', undefined)
  vi.stubGlobal('ManagedMediaSource', FakeManagedMediaSource)
  try {
    return run()
  } finally {
    vi.unstubAllGlobals()
  }
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

describe('usePlaybackMediaSources mpegts.js (M2TS-LL) contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when the M2TS-LL media source is not requested', () => {
    const video = document.createElement('video')
    expect(() => {
      setup({ videoRef: ref(video), effectiveMediaUrl: './live.ts', usesMpegtsMediaSource: false })
    }).not.toThrow()
  })

  it('[AC 3.14] attaches a real mpegts.js MSE player to the video element and loads/plays it', () => {
    withMseStub(() => {
      const video = document.createElement('video')
      document.body.appendChild(video)

      const { unmount } = setup({
        videoRef: ref(video),
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
        usesMpegtsMediaSource: true,
      })

      unmount()
      video.remove()
    })
  })

  it('[AC 4.1] bridges mpegts.js private-data packets into the active subtitle adapter', () => {
    withMseStub(() => {
      const video = document.createElement('video')
      document.body.appendChild(video)
      const pushMpegtsPrivateData = vi.fn()
      const adapter: PlaybackSubtitleAdapter = {
        kind: 'aribb24',
        setVisible: () => undefined,
        pushID3v2Data: () => undefined,
        pushMpegtsPrivateData,
        dispose: () => undefined,
      }

      // player が作られたら、その on() を包んで購読を記録する。購読された handler を後で直接
      // 呼ぶため。本物の PES_PRIVATE_DATA_ARRIVED を出すには実際の transport stream を復号
      // させる必要があり、player の内部構造へ手を入れる形は相手の実装が変わるたびに壊れる。
      const subscriptions: [string, (data: unknown) => void][] = []
      const realCreatePlayer = Mpegts.createPlayer.bind(Mpegts)
      const createPlayer = vi
        .spyOn(Mpegts, 'createPlayer')
        .mockImplementation((...args: Parameters<typeof Mpegts.createPlayer>) => {
          const player = realCreatePlayer(...args)
          const subscribe = player.on.bind(player)
          player.on = ((event: string, handler: (data: unknown) => void) => {
            subscriptions.push([event, handler])
            return subscribe(event as never, handler as never)
          }) as typeof player.on
          return player
        })
      void createPlayer

      setup({
        videoRef: ref(video),
        subtitleAdapterRef: ref<PlaybackSubtitleAdapter | null>(adapter),
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
        usesMpegtsMediaSource: true,
      })

      const packet = { stream_id: 0xbd, pid: 256, data: new Uint8Array([0x80, 1]), pts: 9000 }
      const bridged = subscriptions.filter(
        (call) => call[0] === Mpegts.Events.PES_PRIVATE_DATA_ARRIVED,
      )
      expect(bridged).toHaveLength(1)
      act(() => {
        ;(bridged[0][1] as (data: unknown) => void)(packet)
      })

      expect(pushMpegtsPrivateData).toHaveBeenCalledWith(packet)
      video.remove()
    })
  })

  it('destroys the previous mpegts.js player and creates a new one when the media URL changes', () => {
    withMseStub(() => {
      const video = document.createElement('video')
      document.body.appendChild(video)

      const { rerender, unmount } = setup({
        videoRef: ref(video),
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
        usesMpegtsMediaSource: true,
      })

      rerender({
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/2/m2tsll?mode=0',
        usesHlsJsMediaSource: false,
        usesMpegtsMediaSource: true,
      })

      unmount()
      video.remove()
    })
  })

  it('[iOS MMS] sets video.disableRemotePlayback and uses srcObject when only ManagedMediaSource is available', () => {
    withManagedMediaSourceStub(() => {
      const video = document.createElement('video')
      document.body.appendChild(video)
      expect(video.disableRemotePlayback).not.toBe(true)

      const { unmount } = setup({
        videoRef: ref(video),
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
        usesMpegtsMediaSource: true,
      })

      // mpegts.js's MSEController only opens `video.srcObject` (not `video.src`) for
      // ManagedMediaSource, and Safari will not fire `sourceopen` on it unless
      // `disableRemotePlayback` is set first -- see mpegts.js
      // player-engine-main-thread.ts's attachMediaElement().
      expect(video.srcObject).toBeInstanceOf(FakeManagedMediaSource)
      expect(video.disableRemotePlayback).toBe(true)

      unmount()
      video.remove()
    })
  })

  it('destroys an existing mpegts.js player once M2TS-LL playback is no longer requested', () => {
    withMseStub(() => {
      const video = document.createElement('video')
      document.body.appendChild(video)

      const { rerender } = setup({
        videoRef: ref(video),
        effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
        usesMpegtsMediaSource: true,
      })

      expect(() => {
        rerender({
          effectiveMediaUrl: 'https://epgstation.invalid/api/streams/live/1/m2tsll?mode=0',
          usesHlsJsMediaSource: false,
          usesMpegtsMediaSource: false,
        })
      }).not.toThrow()
      video.remove()
    })
  })
})
