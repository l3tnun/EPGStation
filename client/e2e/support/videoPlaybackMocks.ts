import type { Locator, Page, Route } from '@playwright/test'
import { expect } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'

export const SYNTHETIC_RECORDED_ID = 8101
export const SYNTHETIC_DIRECT_VIDEO_FILE_ID = 7101
export const SYNTHETIC_STREAMING_VIDEO_FILE_ID = 7102
export const SYNTHETIC_HLS_STREAM_ID = 6101

type MockMode = 'success' | 'failure'
type HlsReadinessMode = MockMode | 'pending'
type HlsPlaylistMode = 'success' | 'pending'

export interface VideoPlaybackMockOptions {
  recordedDetail?: MockMode
  hlsStart?: MockMode
  hlsPlaylist?: HlsPlaylistMode
  hlsReadiness?: HlsReadinessMode
}

export interface VideoPlaybackRequestLog {
  apiPaths: string[]
}

export function createVideoPlaybackRequestLog(): VideoPlaybackRequestLog {
  return { apiPaths: [] }
}

const syntheticRecordedDetail = {
  id: SYNTHETIC_RECORDED_ID,
  name: 'Synthetic Playback Program',
  description: 'Synthetic playback description',
  channelName: 'Synthetic Playback Channel',
  isRecording: true,
  thumbnails: [],
  videoFiles: [
    {
      id: SYNTHETIC_DIRECT_VIDEO_FILE_ID,
      name: 'Synthetic Original',
      filename: 'synthetic-original.ts',
      type: 'ts',
      isOriginal: true,
    },
    {
      id: SYNTHETIC_STREAMING_VIDEO_FILE_ID,
      name: 'Synthetic Encoded',
      filename: 'synthetic-encoded.mp4',
      type: 'encoded',
      isOriginal: false,
    },
  ],
}

function createVideoPlaybackHandlers({
  recordedDetail = 'success',
  hlsStart = 'success',
  hlsPlaylist = 'success',
  hlsReadiness = 'success',
}: VideoPlaybackMockOptions = {}) {
  return [
    http.get(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      () => {
        if (recordedDetail === 'failure') {
          return HttpResponse.json({ error: 'synthetic-recorded-detail-failure' }, { status: 503 })
        }

        return HttpResponse.json(syntheticRecordedDetail)
      },
    ),
    http.get(
      ({ request }) => /\/api\/streams\/live\/[^/]+\/hls$/.test(new URL(request.url).pathname),
      () => {
        if (hlsStart === 'failure') {
          return HttpResponse.json({ error: 'synthetic-live-hls-start-failure' }, { status: 503 })
        }

        return HttpResponse.json({ streamId: SYNTHETIC_HLS_STREAM_ID })
      },
    ),
    http.get(
      ({ request }) => /\/api\/streams\/recorded\/\d+\/hls$/.test(new URL(request.url).pathname),
      () => {
        if (hlsStart === 'failure') {
          return HttpResponse.json(
            { error: 'synthetic-recorded-hls-start-failure' },
            { status: 503 },
          )
        }

        return HttpResponse.json({ streamId: SYNTHETIC_HLS_STREAM_ID })
      },
    ),
    http.get(
      ({ request }) => /\/api\/videos\/\d+\/duration$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ duration: 125 }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/streams'),
      () => {
        if (hlsReadiness === 'failure') {
          return HttpResponse.json({ error: 'synthetic-hls-readiness-failure' }, { status: 503 })
        }

        // 'pending' must keep the stream present-but-not-enabled (isEnabled: false), not omit
        // it from items: since playbackLifecycleController.ts's waitForReadiness() now treats a
        // streamId missing from a successful /api/streams response as an immediate terminal
        // failure, an empty items array
        // here would flip this straight to the error state instead of freezing in 'waiting' for
        // the loading-indicator screenshot (visual/video-playback-geometry.spec.ts).
        return HttpResponse.json({
          items: [
            {
              channelId: 301,
              mode: 0,
              type: 'hls',
              name: 'Synthetic Playback Program',
              description: 'Synthetic live playback description',
              startAt: 1700000000000,
              endAt: 1700003600000,
              streamId: SYNTHETIC_HLS_STREAM_ID,
              isEnabled: hlsReadiness !== 'pending',
            },
          ],
        })
      },
    ),
    http.put(
      ({ request }) => /\/api\/streams\/[^/]+\/keep$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({}),
    ),
    http.delete(
      ({ request }) => /\/api\/streams\/[^/]+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({}),
    ),
    http.get(
      ({ request }) =>
        /\/api\/streams\/(?:recorded|live)\//.test(new URL(request.url).pathname) ||
        /\/api\/videos\/\d+$/.test(new URL(request.url).pathname),
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get(
      ({ request }) => /\/streamfiles\/stream[^/]+\.m3u8$/.test(new URL(request.url).pathname),
      async () => {
        if (hlsPlaylist === 'pending') {
          return await new Promise<never>(() => undefined)
        }

        return HttpResponse.text('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-ENDLIST\n', {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        })
      },
    ),
  ]
}

export async function installVideoPlaybackApiMocks(
  page: Page,
  options?: VideoPlaybackMockOptions & { requestLog?: VideoPlaybackRequestLog },
): Promise<void> {
  const handlers = createVideoPlaybackHandlers(options)

  await page.route('**/{api,streamfiles}/**', async (route: Route) => {
    const url = new URL(route.request().url())
    options?.requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export interface VideoPlaybackRealtimeMockController {
  renameRecordedWatchProgram: (name: string) => void
}

export async function installVideoPlaybackRealtimeApiMocks(
  page: Page,
  options?: VideoPlaybackMockOptions & { requestLog?: VideoPlaybackRequestLog },
): Promise<VideoPlaybackRealtimeMockController> {
  let recordedName = syntheticRecordedDetail.name
  const handlers = [
    http.get(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      () =>
        HttpResponse.json({
          ...syntheticRecordedDetail,
          name: recordedName,
        }),
    ),
    ...createVideoPlaybackHandlers(options),
  ]

  await page.route('**/{api,streamfiles}/**', async (route: Route) => {
    const url = new URL(route.request().url())
    options?.requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return {
    renameRecordedWatchProgram: (name) => {
      recordedName = name
    },
  }
}

export async function setSyntheticVideoDuration(
  player: Locator,
  { currentTime = 12, duration = 125 }: { currentTime?: number; duration?: number } = {},
): Promise<void> {
  const video = player.locator('video')

  await video.evaluate(
    (element, values) => {
      const mediaElement = element as HTMLVideoElement
      Object.defineProperty(mediaElement, 'duration', {
        configurable: true,
        value: values.duration,
      })
      mediaElement.currentTime = values.currentTime
      mediaElement.dispatchEvent(new Event('loadedmetadata', { bubbles: true }))
      mediaElement.dispatchEvent(new Event('durationchange', { bubbles: true }))
      mediaElement.dispatchEvent(new Event('loadeddata', { bubbles: true }))
      mediaElement.dispatchEvent(new Event('canplay', { bubbles: true }))
      mediaElement.dispatchEvent(new Event('timeupdate', { bubbles: true }))
    },
    { currentTime, duration },
  )
}

export async function expectPlayerHasNoControlOverlap(player: Locator): Promise<void> {
  const centerBox = await player.getByTestId('playback-center-controls').boundingBox()
  const bottomBox = await player.getByTestId('playback-bottom-controls').boundingBox()

  expect(centerBox).not.toBeNull()
  expect(bottomBox).not.toBeNull()
  expect((centerBox?.y ?? 0) + (centerBox?.height ?? 0)).toBeLessThanOrEqual(bottomBox?.y ?? 0)
}
