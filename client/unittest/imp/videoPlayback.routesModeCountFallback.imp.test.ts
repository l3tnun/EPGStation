import { describe, expect, it } from 'vitest'
import {
  resolveLiveWatchRoute,
  resolveRecordedStreamingWatchRoute,
  resolveRecordedWatchRoute,
} from '@/features/video/playback/playbackRoutes'

describe('Video Playback route mode-count fallbacks without a loaded stream config', () => {
  it('[AC 1.1] rejects every live streaming type when the stream config has not loaded', () => {
    for (const type of ['m2tsll', 'webm', 'mp4', 'hls']) {
      expect(
        resolveLiveWatchRoute({
          search: `?type=${type}&channel=10&mode=0`,
          streamConfig: undefined,
          isConfigLoaded: true,
        }),
      ).toStrictEqual({ ok: false, message: '再生条件が不正です' })
    }
  })

  it('[AC 1.2] rejects a videoId that parses as a digit string but exceeds Number.MAX_SAFE_INTEGER', () => {
    expect(resolveRecordedWatchRoute('?videoId=99999999999999999999')).toStrictEqual({
      ok: false,
      message: '再生対象が不正です',
    })
  })

  it('[AC 1.1] rejects every recorded streaming type when the stream config has not loaded', () => {
    for (const type of ['hls', 'webm', 'mp4']) {
      expect(
        resolveRecordedStreamingWatchRoute({
          videoFileId: '701',
          search: `?streamingType=${type}&mode=0&fileType=ts`,
          streamConfig: undefined,
          isConfigLoaded: true,
        }),
      ).toStrictEqual({ ok: false, message: 'ストリーム再生条件が不正です' })
    }
  })
})
