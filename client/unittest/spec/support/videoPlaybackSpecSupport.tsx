import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import App from '@/App'
import type { NavigationConfigState } from '@/app/navigation'
import type { ServerApiRepository, ServerConfigNavigationState } from '@/app/serverApi'
import type { OnAirApiRepository } from '@/features/onair/onairApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'

export const NOW = Date.parse('2026-05-05T09:00:00+09:00')

export type PlaybackSettings = ReturnType<DefaultSettingsFactory['create']>

export function createPlaybackSettings(
  overrides: Partial<PlaybackSettings> = {},
): PlaybackSettings {
  return { ...new DefaultSettingsFactory().create(), ...overrides }
}

export function createShellRepository() {
  return {
    fetchVersion: vi.fn(async () => ({ ok: true as const, value: { version: '9.9.9' } })),
    fetchServerConfig: vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'loaded' as const,
        liveStreamEnabled: true,
        enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'] as const,
        encodeModes: ['H.264'],
      },
    })),
  }
}

/** Live and recorded stream config so every playback route can be exercised. */
export function createPlaybackNavigationConfig(): ServerConfigNavigationState {
  return {
    status: 'loaded',
    liveStreamEnabled: true,
    enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
    encodeModes: ['H.264'],
    streamConfig: {
      live: {
        ts: {
          m2ts: [{ name: 'm2ts-default' }],
          m2tsll: ['ll-low'],
          webm: ['webm-low'],
          mp4: ['mp4-low'],
          hls: ['hls-low'],
        },
      },
      recorded: {
        ts: { webm: ['ts-webm'], hls: ['ts-hls'] },
        encoded: { webm: ['encoded-webm'], mp4: ['encoded-mp4'], hls: ['encoded-hls'] },
      },
    },
  }
}

export function createOnAirRepository(
  liveStreamItems: readonly {
    channelId: number
    channelName?: string
    mode: number
    name?: string
    description?: string
    startAt?: number
    endAt?: number
  }[] = [],
): OnAirApiRepository & { fetchLiveStreams: ReturnType<typeof vi.fn> } {
  return {
    fetchOnAir: vi.fn(async () => ({
      ok: true as const,
      value: { reserveIndex: {}, schedules: [] },
    })),
    fetchLiveStreams: vi.fn(async () => ({ ok: true as const, value: { items: liveStreamItems } })),
    addProgramReserve: vi.fn(async () => ({ ok: true as const, value: { reserveId: 1 } })),
    deleteReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockSkipReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockOverlapReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

export interface RenderPlaybackOptions {
  hash: string
  settings?: PlaybackSettings
  viewportWidth?: number
  recordedRepository?: RecordedApiRepository
  onAirRepository?: OnAirApiRepository
  navigationConfig?: ServerConfigNavigationState | NavigationConfigState
  apiRepository?: ServerApiRepository
}

export function renderPlayback({
  hash,
  settings = createPlaybackSettings(),
  viewportWidth = 1440,
  recordedRepository = createRecordedRepository(),
  onAirRepository = createOnAirRepository(),
  navigationConfig = createPlaybackNavigationConfig(),
  apiRepository = createShellRepository(),
}: RenderPlaybackOptions) {
  window.history.replaceState(null, '', hash)

  return render(
    <App
      settings={settings}
      apiRepository={apiRepository}
      recordedApiRepository={recordedRepository}
      onAirApiRepository={onAirRepository}
      navigationConfig={navigationConfig}
      osPrefersDark={false}
      viewportWidth={viewportWidth}
      initialDrawerState="none"
    />,
  )
}

export async function navigateHashRoute(hash: string): Promise<void> {
  await act(async () => {
    window.history.pushState(null, '', hash)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

export async function findPlayer(): Promise<HTMLElement> {
  return screen.findByTestId('video-player-container')
}

export function getVideo(): HTMLVideoElement {
  const video = document.querySelector('video')
  if (video === null) {
    throw new Error('video element is missing')
  }

  return video
}

/** Mark the media element as ready to play so the loading indicator clears and controls can show. */
export function readyVideo(video: HTMLVideoElement = getVideo()): void {
  act(() => {
    fireEvent.loadedData(video)
    fireEvent.canPlay(video)
  })
}

export function setVideoDuration(video: HTMLVideoElement, duration: number): void {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  act(() => {
    fireEvent.durationChange(video)
  })
}

export function setVideoCurrentTime(video: HTMLVideoElement, currentTime: number): void {
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    value: currentTime,
    writable: true,
  })
  act(() => {
    fireEvent.timeUpdate(video)
  })
}

export function stubMediaPlayback(): {
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
} {
  const play = vi.fn(async () => undefined)
  const pause = vi.fn(() => undefined)
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })

  return { play, pause }
}

export interface HlsFetchOptions {
  streamId?: number | null
  startStatus?: number
  enabled?: boolean
  /**
   * After this many GET /streams polls have been answered with the stream present, the stream
   * is dropped from the response items (simulating the server removing it -- see
   * StreamManageModel.ts rejectStart()/attachStream()'s setExitStream()). Used to test the
   * "stream disappeared" immediate-failure branch of waitForReadiness() separately from the
   * "isEnabled stays false" still-waiting branch.
   */
  disappearsAfterPolls?: number
}

/** Mock the HLS stream API used by the fetch lifecycle repository (start / readiness / keep / stop). */
export function mockHlsFetch({
  streamId = 82,
  startStatus = 200,
  enabled = true,
  disappearsAfterPolls,
}: HlsFetchOptions = {}) {
  const calls: string[] = []
  let readinessPollCount = 0
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url.includes('/streams/live/') || url.includes('/streams/recorded/')) {
      if (startStatus !== 200) {
        return new Response('{}', { status: startStatus })
      }
      return new Response(JSON.stringify(streamId === null ? {} : { streamId }))
    }
    if (url.includes('/streams?')) {
      readinessPollCount += 1
      if (disappearsAfterPolls !== undefined && readinessPollCount > disappearsAfterPolls) {
        return new Response(JSON.stringify({ items: [] }))
      }
      return new Response(JSON.stringify({ items: [{ streamId, isEnable: enabled }] }))
    }

    return new Response('{}')
  })

  return { spy, calls }
}

export function defineNavigatorForTest({
  userAgent,
  platform,
  maxTouchPoints,
}: {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}): () => void {
  const descriptors = (['userAgent', 'platform', 'maxTouchPoints'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(window.navigator, key)] as const,
  )
  const values = { userAgent, platform, maxTouchPoints }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      Object.defineProperty(window.navigator, key, { configurable: true, value })
    }
  }

  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor !== undefined) {
        Object.defineProperty(window.navigator, key, descriptor)
      } else {
        Reflect.deleteProperty(window.navigator, key)
      }
    }
  }
}

export const IOS_SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

export const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'
