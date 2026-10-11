import { describe, expect, it, vi } from 'vitest'
import { clampPlaybackSeek } from '@/features/video/playback/playbackControls'
import { isInteractiveShortcutTarget } from '@/features/video/playback/lib/playbackShellSupport'
import {
  attachHlsSubtitleMetadataBridge,
  attachMpegtsSubtitleMetadataBridge,
} from '@/features/video/playback/playbackStreamMetadata'
import type { PlaybackSubtitleAdapter } from '@/features/video/playback/playbackSubtitle'

describe('Video Playback shortcut target classification', () => {
  it('returns false for an element that is not inside an interactive control', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    expect(isInteractiveShortcutTarget(div)).toBe(false)

    div.remove()
  })

  it('returns true for an element inside an interactive control and false for non-elements', () => {
    const button = document.createElement('button')
    const span = document.createElement('span')
    button.appendChild(span)
    document.body.appendChild(button)

    expect(isInteractiveShortcutTarget(span)).toBe(true)
    expect(isInteractiveShortcutTarget(null)).toBe(false)

    button.remove()
  })
})

describe('Video Playback seek clamping with unusable durations', () => {
  it('returns 0 for non-finite, zero and negative durations regardless of position', () => {
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: 10, duration: Number.NaN })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: 10, duration: Infinity })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: 10, duration: 0 })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: 10, duration: -10 })).toBe(0)
  })

  it('clamps within a valid duration', () => {
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: 10, duration: 100 })).toBe(15)
    expect(clampPlaybackSeek({ currentTime: 95, deltaSeconds: 10, duration: 100 })).toBe(100)
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: -10, duration: 100 })).toBe(0)
  })
})

describe('Video Playback stream metadata bridge teardown', () => {
  const adapter = {} as PlaybackSubtitleAdapter

  it('unsubscribes the same handler from an HLS source and tolerates a source without off', () => {
    const on = vi.fn()
    const off = vi.fn()
    const dispose = attachHlsSubtitleMetadataBridge({
      hls: { on, off },
      getSubtitleAdapter: () => adapter,
    })
    expect(off).not.toHaveBeenCalled()
    dispose()
    expect(off).toHaveBeenCalledTimes(1)
    expect(off).toHaveBeenCalledWith(on.mock.calls[0][0], on.mock.calls[0][1])

    const disposeWithoutOff = attachHlsSubtitleMetadataBridge({
      hls: { on: vi.fn() },
      getSubtitleAdapter: () => adapter,
    })
    expect(() => disposeWithoutOff()).not.toThrow()
  })

  it('unsubscribes the same handler from an mpegts source and tolerates a source without off', () => {
    const on = vi.fn()
    const off = vi.fn()
    const dispose = attachMpegtsSubtitleMetadataBridge({
      player: { on, off },
      getSubtitleAdapter: () => adapter,
    })
    expect(off).not.toHaveBeenCalled()
    dispose()
    expect(off).toHaveBeenCalledTimes(1)
    expect(off).toHaveBeenCalledWith(on.mock.calls[0][0], on.mock.calls[0][1])

    const disposeWithoutOff = attachMpegtsSubtitleMetadataBridge({
      player: { on: vi.fn() },
      getSubtitleAdapter: () => adapter,
    })
    expect(() => disposeWithoutOff()).not.toThrow()
  })
})
