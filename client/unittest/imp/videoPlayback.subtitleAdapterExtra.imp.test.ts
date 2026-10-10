import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAribb24BaseOptions,
  createNativeTextTrackSubtitleAdapter,
  createPlaybackSubtitleAdapter,
  pushMpegtsPrivateData,
} from '@/features/video/playback/playbackSubtitle'
import { setNavigatorPlatform } from './support/videoPlaybackFixtures'

function makeTextTrackVideo(track: TextTrack): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'textTracks', {
    configurable: true,
    value: { 0: track, length: 1 },
  })

  return video
}

describe('Video Playback subtitle adapter contract edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('[AC 4.2] prefers the native text track adapter over aribb24 when preferRenderer is not set', () => {
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    const video = makeTextTrackVideo(track)

    const adapter = createPlaybackSubtitleAdapter({
      video,
      rendererKind: 'aribb24',
      strokeEnabled: true,
    })

    expect(adapter?.kind).toBe('native-text-track')
    adapter?.setVisible(true)
    expect(track.mode).toBe('showing')
    // The native adapter's ID3/mpegts hooks and dispose are intentional no-ops.
    expect(() => adapter?.pushID3v2Data(0, new Uint8Array())).not.toThrow()
    expect(() =>
      adapter?.pushMpegtsPrivateData({
        stream_id: 0xbd,
        pid: 1,
        data: new Uint8Array([0x80]),
        pts: 0,
      }),
    ).not.toThrow()
    expect(() => adapter?.dispose()).not.toThrow()
  })

  it('returns null when no renderer is requested and no native text track exists', () => {
    const video = document.createElement('video')
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: { length: 0 },
    })

    expect(
      createPlaybackSubtitleAdapter({ video, rendererKind: 'none', strokeEnabled: false }),
    ).toBeNull()
  })

  it('resolves the first text track through TextTrackList.item when available', () => {
    const track = { mode: 'disabled' as TextTrackMode } as TextTrack
    const video = document.createElement('video')
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: {
        length: 1,
        item: (index: number) => (index === 0 ? track : null),
      },
    })

    const adapter = createNativeTextTrackSubtitleAdapter(video)
    expect(adapter?.kind).toBe('native-text-track')
  })

  it('falls back to null when an indexed TextTrackList entry is missing', () => {
    const video = document.createElement('video')
    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: { length: 1 },
    })

    expect(createNativeTextTrackSubtitleAdapter(video)).toBeNull()
  })

  it('ignores mpegts private data packets without a feedB24 sink', () => {
    expect(() =>
      pushMpegtsPrivateData({}, { stream_id: 0xbd, pid: 1, data: new Uint8Array([0x80]), pts: 0 }),
    ).not.toThrow()
  })

  it('ignores mpegts private data packets outside the ARIB caption stream ids', () => {
    const feedB24 = vi.fn()
    pushMpegtsPrivateData(
      { caption: { feedB24 }, superimpose: { feedB24 } },
      { stream_id: 0x01, pid: 1, data: new Uint8Array([0x80]), pts: 0 },
    )
    expect(feedB24).not.toHaveBeenCalled()
  })

  it('parses a well-formed 0xbf superimpose PES payload directly and applies the nearest_pts fallback', () => {
    const feedB24 = vi.fn()
    pushMpegtsPrivateData(
      { superimpose: { feedB24 } },
      { stream_id: 0xbf, pid: 2, data: new Uint8Array([0x81, 1, 2]), pts: 3000 },
    )
    expect(feedB24).toHaveBeenCalledWith(new Uint8Array([0x81, 1, 2]), 3)

    feedB24.mockClear()
    pushMpegtsPrivateData(
      { superimpose: { feedB24 } },
      {
        stream_id: 0xbf,
        pid: 2,
        data: new Uint8Array([0x81, 1, 2]),
        pts: 3000,
        nearest_pts: 6000,
      },
    )
    expect(feedB24).toHaveBeenCalledWith(new Uint8Array([0x81, 1, 2]), 6)
  })

  it('discards a malformed 0xbf superimpose PES payload that never yields the ARIB marker byte', () => {
    const feedB24 = vi.fn()
    // ptsDtsFlags bits (0xc0 mask) are 0, so the header length byte is ignored and the
    // payload starts at offset 3 -- which does not begin with the 0x81 ARIB marker.
    pushMpegtsPrivateData(
      { superimpose: { feedB24 } },
      { stream_id: 0xbf, pid: 2, data: new Uint8Array([0x00, 0x00, 0, 0x00, 0x01]), pts: 0 },
    )
    expect(feedB24).not.toHaveBeenCalled()
  })

  it('parses a malformed 0xbf superimpose PES payload once the PTS/DTS header is skipped', () => {
    const feedB24 = vi.fn()
    // ptsDtsFlags = 0x02 selects the "3 + pesHeaderDataLength" payload offset branch.
    const data = new Uint8Array([0x00, 0x80, 2, 0xaa, 0xbb, 0x81, 9])
    pushMpegtsPrivateData(
      { superimpose: { feedB24 } },
      { stream_id: 0xbf, pid: 2, data, pts: 1000 },
    )
    expect(feedB24).toHaveBeenCalledWith(new Uint8Array([0x81, 9]), 1)
  })

  it('[AC 4.1a] routes caption and superimpose PES packets to their own feeder only, never the other', () => {
    const captionFeedB24 = vi.fn()
    const superimposeFeedB24 = vi.fn()
    const feeders = {
      caption: { feedB24: captionFeedB24 },
      superimpose: { feedB24: superimposeFeedB24 },
    }

    pushMpegtsPrivateData(feeders, {
      stream_id: 0xbd,
      pid: 256,
      data: new Uint8Array([0x80, 0xaa]),
      pts: 9000,
    })
    expect(captionFeedB24).toHaveBeenCalledWith(new Uint8Array([0x80, 0xaa]), 9)
    expect(superimposeFeedB24).not.toHaveBeenCalled()

    captionFeedB24.mockClear()
    superimposeFeedB24.mockClear()

    pushMpegtsPrivateData(feeders, {
      stream_id: 0xbf,
      pid: 300,
      data: new Uint8Array([0x81, 0xbb]),
      pts: 12000,
    })
    expect(superimposeFeedB24).toHaveBeenCalledWith(new Uint8Array([0x81, 0xbb]), 12)
    expect(captionFeedB24).not.toHaveBeenCalled()
  })

  it('uses the Windows Firefox aribb24 font family only when both platform signals match', () => {
    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/120.0',
    })
    expect(createAribb24BaseOptions({ strokeEnabled: false })).toMatchObject({
      font: {
        normal: '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif',
        arib: '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif',
      },
    })

    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    })
    expect(createAribb24BaseOptions({ strokeEnabled: true })).toMatchObject({
      font: {
        normal:
          '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif',
      },
      color: { stroke: 'black' },
    })
  })

  it('loads the real aribb24.js CanvasRenderer by default when no loader override is given', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    const adapter = createPlaybackSubtitleAdapter({
      video,
      rendererKind: 'aribb24',
      strokeEnabled: false,
      preferRenderer: true,
    })

    expect(adapter?.kind).toBe('aribb24')
    expect(() => adapter?.dispose()).not.toThrow()
    video.remove()
  })

  it('treats a missing navigator as not Windows Firefox', () => {
    vi.stubGlobal('navigator', undefined)
    expect(createAribb24BaseOptions({ strokeEnabled: false })).toMatchObject({
      font: {
        normal:
          '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif',
      },
    })
  })
})
