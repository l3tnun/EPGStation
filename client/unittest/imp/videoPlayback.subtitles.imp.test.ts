import { describe, expect, it, vi } from 'vitest'
import {
  readVideoPlayerSetting,
  resolveSubtitleRendererContract,
  saveVideoPlayerSetting,
} from '@/features/video/playback/playbackSettings'
import {
  createNativeTextTrackSubtitleAdapter,
  createPlaybackSubtitleAdapter,
} from '@/features/video/playback/playbackSubtitle'

describe('Video playback subtitle settings and shared controls', () => {
  it('restores and saves VideoPlayerSetting without changing the adjacent storage contract', () => {
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

    expect(readVideoPlayerSetting(adapter)).toStrictEqual({ isShowSubtitle: false })

    storage.set('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    expect(readVideoPlayerSetting(adapter)).toStrictEqual({ isShowSubtitle: true })

    saveVideoPlayerSetting(adapter, { isShowSubtitle: false })
    expect(storage.get('VideoPlayerSetting')).toBe('{"isShowSubtitle":false}')
  })

  it('mounts subtitle renderer contract only for HLS and live M2TS-LL with stroke setting', () => {
    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'hls-stream',
        streamingType: 'hls',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
        hasSubtitleTrack: true,
      }),
    ).toStrictEqual({
      rendererMounted: true,
      rendererKind: 'aribb24',
      strokeEnabled: true,
      isShowSubtitle: true,
      hasSubtitleTrack: true,
    })

    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-stream',
        streamingType: 'm2tsll',
        isForceEnableSubtitleStroke: false,
        isShowSubtitle: false,
        hasSubtitleTrack: false,
      }),
    ).toStrictEqual({
      rendererMounted: true,
      rendererKind: 'aribb24',
      strokeEnabled: false,
      isShowSubtitle: false,
      hasSubtitleTrack: false,
    })

    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-stream',
        streamingType: 'mp4',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
        hasSubtitleTrack: true,
      }),
    ).toStrictEqual({
      rendererMounted: false,
      rendererKind: 'none',
      strokeEnabled: false,
      isShowSubtitle: false,
      hasSubtitleTrack: true,
    })

    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-video',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
      }),
    ).toStrictEqual({
      rendererMounted: false,
      rendererKind: 'none',
      strokeEnabled: false,
      isShowSubtitle: false,
      hasSubtitleTrack: false,
    })
  })

  it('reflects the actual native text track availability for direct/mp4 playback instead of forcing false', () => {
    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-video',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
        hasSubtitleTrack: false,
      }),
    ).toMatchObject({ rendererMounted: false, hasSubtitleTrack: false })

    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-video',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
        hasSubtitleTrack: true,
      }),
    ).toMatchObject({ rendererMounted: false, hasSubtitleTrack: true })

    expect(
      resolveSubtitleRendererContract({
        sourceKind: 'direct-stream',
        streamingType: 'webm',
        isForceEnableSubtitleStroke: true,
        isShowSubtitle: true,
        hasSubtitleTrack: true,
      }),
    ).toMatchObject({ rendererMounted: false, hasSubtitleTrack: true })
  })

  it('applies subtitle visibility to native text tracks', () => {
    const video = document.createElement('video')
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: {
        0: track,
        length: 1,
      },
    })

    const adapter = createNativeTextTrackSubtitleAdapter(video)

    expect(adapter?.kind).toBe('native-text-track')
    adapter?.setVisible(true)
    expect(track.mode).toBe('showing')
    adapter?.setVisible(false)
    expect(track.mode).toBe('disabled')
  })

  it('mounts aribb24 renderer with stroke options and applies visibility/dispose side effects', () => {
    const calls: string[] = []
    class FakeController {
      public attachFeeder(): void {
        calls.push('attachFeeder')
      }
      public detachFeeder(): void {
        calls.push('detachFeeder')
      }
      public attachRenderer(): void {
        calls.push('attachRenderer')
      }
      public detachRenderer(): void {
        calls.push('detachRenderer')
      }
      public attachMedia(): void {
        calls.push('attachMedia')
      }
      public detachMedia(): void {
        calls.push('detachMedia')
      }
      public show(): void {
        calls.push('show')
      }
      public hide(): void {
        calls.push('hide')
      }
    }
    class FakeFeeder {
      public feedID3(data: Uint8Array, pts: number): void {
        calls.push(`id3:${pts}:${data[0]}`)
      }
      public feedB24(data: Uint8Array, pts: number): void {
        calls.push(`pes:${data[0]}:${pts}`)
      }
      public destroy(): void {
        calls.push('feeder:destroy')
      }
    }
    class FakeRenderer {
      public constructor(public readonly options: Record<string, unknown>) {
        const color = options.color as Record<string, unknown> | undefined
        calls.push(`construct:${String(color?.stroke)}`)
      }
      public destroy(): void {
        calls.push('renderer:destroy')
      }
    }

    const adapter = createPlaybackSubtitleAdapter({
      video: document.createElement('video'),
      rendererKind: 'aribb24',
      strokeEnabled: true,
      loadAribb24Module: () => ({
        Controller: FakeController,
        Feeder: FakeFeeder,
        Renderer: FakeRenderer,
      }),
    })

    expect(adapter?.kind).toBe('aribb24')
    adapter?.setVisible(true)
    adapter?.setVisible(false)
    adapter?.pushID3v2Data(12, new Uint8Array([7]))
    adapter?.pushMpegtsPrivateData({
      stream_id: 0xbd,
      pid: 256,
      data: new Uint8Array([0x80, 1]),
      pts: 9000,
    })
    adapter?.pushMpegtsPrivateData({
      stream_id: 0xbf,
      pid: 257,
      data: new Uint8Array([0x81, 2]),
      pts: 11000,
    })
    adapter?.dispose()
    // [VP-1] caption and superimpose ARIB data groups are decoded by two independent
    // Controller/Feeder/Renderer triples (aribb24.js 2.x's Feeder discards whichever
    // data group doesn't match its own `recieve.type`), so every lifecycle step below
    // happens twice -- once per subsystem -- and a 0xbd/0x80 caption packet must reach
    // only the caption feeder's feedB24 (a single 'pes:128:9', not two).
    expect(calls).toStrictEqual([
      'construct:black',
      'attachFeeder',
      'attachRenderer',
      'attachMedia',
      'construct:black',
      'attachFeeder',
      'attachRenderer',
      'attachMedia',
      'show',
      'show',
      'hide',
      'hide',
      'id3:12:7',
      'id3:12:7',
      'pes:128:9',
      'pes:129:11',
      'hide',
      'detachMedia',
      'detachFeeder',
      'detachRenderer',
      'feeder:destroy',
      'renderer:destroy',
      'hide',
      'detachMedia',
      'detachFeeder',
      'detachRenderer',
      'feeder:destroy',
      'renderer:destroy',
    ])
  })

  it('[VP-1] constructs a Superimpose-type Feeder alongside the default Caption-type Feeder', () => {
    class FakeController {
      public attachFeeder(): void {
        return undefined
      }
      public detachFeeder(): void {
        return undefined
      }
      public attachRenderer(): void {
        return undefined
      }
      public detachRenderer(): void {
        return undefined
      }
      public attachMedia(): void {
        return undefined
      }
      public detachMedia(): void {
        return undefined
      }
      public show(): void {
        return undefined
      }
      public hide(): void {
        return undefined
      }
    }
    const feederOptions: Array<Record<string, unknown> | undefined> = []
    class FakeFeeder {
      public constructor(option?: Record<string, unknown>) {
        feederOptions.push(option)
      }
      public feedID3(): void {
        return undefined
      }
      public feedB24(): void {
        return undefined
      }
      public destroy(): void {
        return undefined
      }
    }
    class FakeRenderer {
      public destroy(): void {
        return undefined
      }
    }

    createPlaybackSubtitleAdapter({
      video: document.createElement('video'),
      rendererKind: 'aribb24',
      strokeEnabled: false,
      loadAribb24Module: () => ({
        Controller: FakeController,
        Feeder: FakeFeeder,
        Renderer: FakeRenderer,
      }),
    })

    expect(feederOptions).toHaveLength(2)
    // One Feeder keeps the library default (recieve.type: 'Caption'), the other is
    // explicitly constructed for the ARIB "字幕スーパー" data group.
    expect(feederOptions).toContainEqual({ recieve: { type: 'Superimpose' } })
    expect(feederOptions.some((option) => option === undefined)).toBe(true)
  })

  it('keeps aribb24 renderer preferred over browser metadata tracks for renderer-backed playback', () => {
    class FakeController {
      public attachFeeder(): void {
        return undefined
      }
      public detachFeeder(): void {
        return undefined
      }
      public attachRenderer(): void {
        return undefined
      }
      public detachRenderer(): void {
        return undefined
      }
      public attachMedia(): void {
        return undefined
      }
      public detachMedia(): void {
        return undefined
      }
      public show(): void {
        return undefined
      }
      public hide(): void {
        return undefined
      }
    }
    class FakeFeeder {
      public feedID3(): void {
        return undefined
      }
      public feedB24(): void {
        return undefined
      }
      public destroy(): void {
        return undefined
      }
    }
    class FakeRenderer {
      public destroy(): void {
        return undefined
      }
    }
    const video = document.createElement('video')
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: {
        0: { mode: 'disabled' },
        length: 1,
      },
    })

    const adapter = createPlaybackSubtitleAdapter({
      video,
      rendererKind: 'aribb24',
      strokeEnabled: false,
      preferRenderer: true,
      loadAribb24Module: () => ({
        Controller: FakeController,
        Feeder: FakeFeeder,
        Renderer: FakeRenderer,
      }),
    })

    expect(adapter?.kind).toBe('aribb24')
  })
})
