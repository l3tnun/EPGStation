import { describe, expect, it } from 'vitest'
import { buildPlaybackMediaSource } from '@/features/video/playback/playbackMedia'

describe('Video playback media source URL composition', () => {
  it('drops a single trailing slash from the base path before joining', () => {
    expect(
      buildPlaybackMediaSource({
        route: {
          kind: 'recorded-direct',
          videoFileId: 5,
          recordedId: 1,
          shouldRenderInfoCard: true,
        },
        isHalfWidth: false,
        basePath: '/sub/api/',
      }),
    ).toStrictEqual({ sourceKind: 'direct-video', mediaUrl: '/sub/api/videos/5' })
  })

  it('builds the live HLS start URL and a readiness URL carrying the half-width flag', () => {
    const route = { kind: 'live', channelId: 12, streamingType: 'hls', mode: 3 } as const

    expect(buildPlaybackMediaSource({ route, isHalfWidth: true })).toStrictEqual({
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/live/12/hls?mode=3',
      readinessUrl: './api/streams?isHalfWidth=true',
    })
    expect(buildPlaybackMediaSource({ route, isHalfWidth: false })).toStrictEqual({
      sourceKind: 'hls-stream',
      streamStartUrl: './api/streams/live/12/hls?mode=3',
      readinessUrl: './api/streams?isHalfWidth=false',
    })
  })

  it('keeps live direct streams other than m2tsll relative even when a base URL is given', () => {
    expect(
      buildPlaybackMediaSource({
        route: { kind: 'live', channelId: 7, streamingType: 'm2ts', mode: 1 },
        isHalfWidth: false,
        baseUrl: 'https://epgstation.example/',
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: './api/streams/live/7/m2ts?mode=1',
    })
  })

  it('keeps live m2tsll relative when no base URL is given', () => {
    expect(
      buildPlaybackMediaSource({
        route: { kind: 'live', channelId: 7, streamingType: 'm2tsll', mode: 1 },
        isHalfWidth: false,
      }),
    ).toStrictEqual({
      sourceKind: 'direct-stream',
      mediaUrl: './api/streams/live/7/m2tsll?mode=1',
    })
  })
})
