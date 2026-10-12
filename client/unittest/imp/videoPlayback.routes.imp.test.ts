import { describe, expect, it } from 'vitest'
import {
  resolveLiveWatchRoute,
  resolveRecordedStreamingWatchRoute,
  resolveRecordedWatchRoute,
} from '@/features/video/playback/playbackRoutes'
import { streamConfig } from './support/videoPlaybackFixtures'

describe('Video playback route validation', () => {
  it('validates live watch query against finite ids and available web stream modes', () => {
    expect(
      resolveLiveWatchRoute({
        search: '?type=webm&channel=10&mode=1',
        streamConfig,
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'live',
        channelId: 10,
        mode: 1,
        streamingType: 'webm',
      },
    })

    expect(
      resolveLiveWatchRoute({ search: '?type=m2ts&channel=10&mode=0', streamConfig }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'live',
        channelId: 10,
        mode: 0,
        streamingType: 'm2ts',
      },
    })
    expect(
      resolveLiveWatchRoute({ search: '?type=mp4&channel=10&mode=0', streamConfig }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'live',
        channelId: 10,
        mode: 0,
        streamingType: 'mp4',
      },
    })
    expect(
      resolveLiveWatchRoute({ search: '?type=webm&channel=10&mode=2', streamConfig }),
    ).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
    expect(
      resolveLiveWatchRoute({ search: '?type=webm&channel=Infinity&mode=0', streamConfig }),
    ).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
    expect(
      resolveLiveWatchRoute({ search: '?type=webm&channel=&mode=0', streamConfig }),
    ).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
  })

  it('keeps the legacy blank live watch surface when query parameters are absent', () => {
    expect(resolveLiveWatchRoute({ search: '', streamConfig })).toStrictEqual({
      ok: false,
      reason: 'pending-config',
      message: null,
    })
  })

  it('keeps recorded direct playback valid when only optional recordedId is invalid', () => {
    expect(resolveRecordedWatchRoute('?videoId=701&recordedId=301')).toStrictEqual({
      ok: true,
      value: {
        kind: 'recorded-direct',
        videoFileId: 701,
        recordedId: 301,
        shouldRenderInfoCard: true,
      },
    })
    expect(resolveRecordedWatchRoute('?videoId=701&recordedId=bad')).toStrictEqual({
      ok: true,
      value: {
        kind: 'recorded-direct',
        videoFileId: 701,
        recordedId: null,
        shouldRenderInfoCard: false,
      },
    })
    expect(resolveRecordedWatchRoute('?recordedId=301')).toStrictEqual({
      ok: false,
      message: '再生対象が不正です',
    })
  })

  it('validates recorded streaming path and suppresses info card for invalid optional recordedId', () => {
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=hls&mode=0&fileType=ts&recordedId=bad',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'recorded-streaming',
        videoFileId: 701,
        fileType: 'ts',
        mode: 0,
        streamingType: 'hls',
        recordedId: null,
        shouldRenderInfoCard: false,
      },
    })

    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: 'not-a-number',
        search: '?streamingType=hls&mode=0&fileType=ts&recordedId=301',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: false,
      message: 'ストリーム再生条件が不正です',
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=m2ts&mode=0&fileType=ts&recordedId=301',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: false,
      message: 'ストリーム再生条件が不正です',
    })
  })

  it('does not merge recorded stream mode lists across video file types', () => {
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=hls&mode=1&fileType=ts&recordedId=301',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: false,
      message: 'ストリーム再生条件が不正です',
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=hls&mode=1&fileType=encoded&recordedId=301',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'recorded-streaming',
        videoFileId: 701,
        fileType: 'encoded',
        mode: 1,
        streamingType: 'hls',
        recordedId: 301,
        shouldRenderInfoCard: true,
      },
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=hls&mode=0&recordedId=301',
        streamConfig,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: false,
      message: 'ストリーム再生条件が不正です',
    })
  })

  it('keeps live playback route valid while stream config is not loaded', () => {
    expect(
      resolveLiveWatchRoute({
        search: '?type=webm&channel=10&mode=1',
        streamConfig: undefined,
        isConfigLoaded: false,
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        kind: 'live',
        channelId: 10,
        mode: 1,
        streamingType: 'webm',
      },
    })
    expect(
      resolveLiveWatchRoute({
        search: '?type=m2ts&channel=10&mode=0',
        streamConfig: undefined,
        isConfigLoaded: true,
      }),
    ).toStrictEqual({
      ok: false,
      message: '再生条件が不正です',
    })
    expect(
      resolveRecordedStreamingWatchRoute({
        videoFileId: '701',
        search: '?streamingType=hls&mode=0&fileType=ts&recordedId=301',
        streamConfig: undefined,
        isConfigLoaded: false,
      }),
    ).toStrictEqual({
      ok: false,
      reason: 'pending-config',
      message: null,
    })
  })
})
