import { describe, expect, it } from 'vitest'
import {
  clampPlaybackSeek,
  resolvePlaybackControlVisibility,
  resolveVolumeControlIcon,
  resolveVolumeControlLabel,
} from '@/features/video/playback/playbackControls'
import {
  createAribb24BaseOptions,
  pushMpegtsPrivateData,
  type PlaybackSubtitleAdapter,
} from '@/features/video/playback/playbackSubtitle'
import {
  attachHlsSubtitleMetadataBridge,
  attachMpegtsSubtitleMetadataBridge,
} from '@/features/video/playback/playbackStreamMetadata'

describe('Video playback subtitle settings and shared controls', () => {
  it('bridges HLS metadata and mpegts private data events into the subtitle adapter', () => {
    const calls: string[] = []
    const hlsHandlers = new Map<string, (event: string, data: { samples: never[] }) => void>()
    const mpegtsHandlers = new Map<
      string,
      (data: Parameters<PlaybackSubtitleAdapter['pushMpegtsPrivateData']>[0]) => void
    >()
    const adapter: PlaybackSubtitleAdapter = {
      kind: 'aribb24',
      setVisible: () => undefined,
      pushID3v2Data: (pts, data) => calls.push(`hls:${pts}:${data[0]}`),
      pushMpegtsPrivateData: (packet) => calls.push(`m2ts:${packet.stream_id}:${packet.data[0]}`),
      dispose: () => undefined,
    }

    const detachHls = attachHlsSubtitleMetadataBridge({
      hls: {
        on: (event, handler) => hlsHandlers.set(event, handler),
        off: (event) => hlsHandlers.delete(event),
      },
      getSubtitleAdapter: () => adapter,
    })
    hlsHandlers.forEach((handler, event) =>
      handler(event, { samples: [{ pts: 3, data: new Uint8Array([4]) }] as never[] }),
    )
    detachHls()

    const detachMpegts = attachMpegtsSubtitleMetadataBridge({
      player: {
        on: (event, handler) => mpegtsHandlers.set(event, handler),
        off: (event) => mpegtsHandlers.delete(event),
      },
      getSubtitleAdapter: () => adapter,
    })
    mpegtsHandlers.forEach((handler) =>
      handler({
        stream_id: 0xbd,
        pid: 256,
        data: new Uint8Array([0x80]),
        pts: 9000,
      }),
    )
    detachMpegts()

    expect(calls).toStrictEqual(['hls:3:4', 'm2ts:189:128'])
    expect(hlsHandlers.size).toBe(0)
    expect(mpegtsHandlers.size).toBe(0)
  })

  it('drops HLS metadata and mpegts private data while no subtitle adapter is attached', () => {
    const hlsHandlers = new Map<string, (event: string, data: { samples: never[] }) => void>()
    const mpegtsHandlers = new Map<
      string,
      (data: Parameters<PlaybackSubtitleAdapter['pushMpegtsPrivateData']>[0]) => void
    >()

    const detachHls = attachHlsSubtitleMetadataBridge({
      hls: {
        on: (event, handler) => hlsHandlers.set(event, handler),
        off: (event) => hlsHandlers.delete(event),
      },
      getSubtitleAdapter: () => null,
    })
    const detachMpegts = attachMpegtsSubtitleMetadataBridge({
      player: {
        on: (event, handler) => mpegtsHandlers.set(event, handler),
        off: (event) => mpegtsHandlers.delete(event),
      },
      getSubtitleAdapter: () => null,
    })

    expect(() =>
      hlsHandlers.forEach((handler, event) =>
        handler(event, { samples: [{ pts: 3, data: new Uint8Array([4]) }] as never[] }),
      ),
    ).not.toThrow()
    expect(() =>
      mpegtsHandlers.forEach((handler) =>
        handler({ stream_id: 0xbd, pid: 256, data: new Uint8Array([0x80]), pts: 9000 }),
      ),
    ).not.toThrow()

    detachHls()
    detachMpegts()
    expect(hlsHandlers.size).toBe(0)
    expect(mpegtsHandlers.size).toBe(0)
  })

  it('parses malformed mpegts superimpose payloads before pushing aribb24 data', () => {
    const calls: string[] = []
    pushMpegtsPrivateData(
      {
        superimpose: {
          feedB24: (data, pts) => calls.push(`${data[0]}:${pts}`),
        },
      },
      {
        stream_id: 0xbf,
        pid: 300,
        data: new Uint8Array([0x00, 0x80, 0x05, 0, 0, 0, 0, 0, 0x81, 0x99]),
        pts: 1000,
        nearest_pts: 2000,
      },
    )

    expect(calls).toStrictEqual(['129:2'])
  })

  it('builds aribb24 options without stroke override when the setting is disabled', () => {
    expect(createAribb24BaseOptions({ strokeEnabled: false })).not.toHaveProperty('color')
  })

  it('resolves shared control visibility from duration, browser API, platform, and viewport', () => {
    expect(
      resolvePlaybackControlVisibility({
        duration: 120,
        viewportWidth: 1440,
        isMobilePlatform: false,
        canLockOrientation: true,
        isPictureInPictureEnabled: true,
        hasSubtitleTrack: true,
      }),
    ).toStrictEqual({
      canSeek: true,
      showSeekBar: true,
      showFastSeekControls: true,
      showSpeedControls: true,
      showBottomPlayButton: true,
      showVolumeSlider: true,
      showSubtitleButton: true,
      showPictureInPictureButton: true,
      showRotationButton: false,
      timeDisplay: '00:00/02:00',
    })

    expect(
      resolvePlaybackControlVisibility({
        duration: 0,
        viewportWidth: 1440,
        isMobilePlatform: false,
        canLockOrientation: true,
        isPictureInPictureEnabled: false,
        hasSubtitleTrack: false,
      }).showBottomPlayButton,
    ).toBe(true)

    // Narrow viewport during live/duration-unknown playback: the seek bar stays
    // rendered (disabled via canSeek) and the subtitle button is driven solely by
    // hasSubtitleTrack, matching the v2 behavior (VideoContainer.vue's seek bar is
    // always rendered with :disabled="duration===0", and the subtitle button uses
    // only v-if="isEnabledSubtitles").
    expect(
      resolvePlaybackControlVisibility({
        duration: 0,
        viewportWidth: 390,
        isMobilePlatform: true,
        canLockOrientation: true,
        isPictureInPictureEnabled: false,
        hasSubtitleTrack: true,
      }),
    ).toStrictEqual({
      canSeek: false,
      showSeekBar: true,
      showFastSeekControls: false,
      showSpeedControls: false,
      showBottomPlayButton: false,
      showVolumeSlider: false,
      showSubtitleButton: true,
      showPictureInPictureButton: false,
      showRotationButton: true,
      timeDisplay: '--:--/--:--',
    })

    expect(
      resolvePlaybackControlVisibility({
        duration: 0,
        viewportWidth: 390,
        isMobilePlatform: true,
        canLockOrientation: false,
        isPictureInPictureEnabled: false,
        hasSubtitleTrack: false,
      }).showRotationButton,
    ).toBe(false)
  })

  it('clamps seek controls and resolves volume labels at the specified thresholds', () => {
    expect(clampPlaybackSeek({ currentTime: 5, deltaSeconds: -30, duration: 120 })).toBe(0)
    expect(clampPlaybackSeek({ currentTime: 115, deltaSeconds: 30, duration: 120 })).toBe(120)
    expect(resolveVolumeControlLabel({ volume: 0.8, muted: false })).toBe('VOL+')
    expect(resolveVolumeControlLabel({ volume: 0.4, muted: false })).toBe('VOL~')
    expect(resolveVolumeControlLabel({ volume: 0, muted: false })).toBe('MUTE')
    expect(resolveVolumeControlLabel({ volume: 0.8, muted: true })).toBe('MUTE')
  })

  it('[AC 4.11] derives the volume icon from the same boundary as the volume label', () => {
    expect(resolveVolumeControlIcon({ volume: 0.8, muted: false })).toBe('volume-high')
    expect(resolveVolumeControlIcon({ volume: 0.4, muted: false })).toBe('volume-medium')
    expect(resolveVolumeControlIcon({ volume: 0, muted: false })).toBe('volume-off')
    expect(resolveVolumeControlIcon({ volume: 0.8, muted: true })).toBe('volume-off')

    // A value below the mute threshold must resolve to the same label/icon pairing
    // instead of the two independently-coded boundaries (`volume <= 0` vs `volume === 0`)
    // disagreeing with each other.
    const outOfRangeVolume = -0.1
    const label = resolveVolumeControlLabel({ volume: outOfRangeVolume, muted: false })
    const icon = resolveVolumeControlIcon({ volume: outOfRangeVolume, muted: false })
    expect(label).toBe('MUTE')
    expect(icon).toBe('volume-off')
  })
})
