import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import App from '@/App'
import type { RealtimeEventName } from '@/app/realtime'
import type { OnAirApiRepository, OnAirSchedule } from '@/features/onair/onairApi'
import type { OnAirReserveIndex } from '@/features/onair/onairRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

export class SyntheticRealtimeConnection {
  private readonly listeners = new Map<RealtimeEventName, Set<() => void>>()

  on(eventName: RealtimeEventName, listener: () => void): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<() => void>()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
  }

  off(eventName: RealtimeEventName, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: RealtimeEventName): void {
    this.listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }
}

export const NOW = Date.parse('2026-05-05T09:00:00+09:00')
export const playbackCss = readFileSync(
  `${process.cwd()}/src/features/video/playback/PlaybackPage.module.css`,
  'utf8',
)
export const onAirCss = readFileSync(
  `${process.cwd()}/src/features/onair/OnAirPage.module.css`,
  'utf8',
)

export function createShellRepository() {
  return {
    fetchVersion: vi.fn(async () => ({
      ok: true as const,
      value: {
        version: '9.9.9',
      },
    })),
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

export function createSchedule(
  channelType: 'GR' | 'BS' | 'CS' | 'SKY',
  programId: number,
  offsetMinutes: number,
): OnAirSchedule {
  return {
    channel: {
      id: programId,
      name: `Synthetic ${channelType}`,
      channelType,
      hasLogoData: programId % 2 === 0,
    },
    programs: [
      {
        id: programId,
        name: `Synthetic ${channelType} program`,
        description: `Synthetic ${channelType} description`,
        startAt: NOW - 30 * 60 * 1000,
        endAt: NOW + offsetMinutes * 60 * 1000,
      },
    ],
  }
}

export function createOnAirRepository(
  schedules: readonly OnAirSchedule[],
  reserveIndex: OnAirReserveIndex = {},
  liveStreamItems: readonly {
    channelId: number
    channelName?: string
    mode: number
    type?: string
    name?: string
    description?: string
    startAt?: number
    endAt?: number
  }[] = [],
): OnAirApiRepository & {
  fetchOnAir: ReturnType<typeof vi.fn>
  fetchLiveStreams: ReturnType<typeof vi.fn>
  addProgramReserve: ReturnType<typeof vi.fn>
  deleteReserve: ReturnType<typeof vi.fn>
  unlockSkipReserve: ReturnType<typeof vi.fn>
  unlockOverlapReserve: ReturnType<typeof vi.fn>
} {
  return {
    fetchOnAir: vi.fn(async () => ({
      ok: true as const,
      value: {
        reserveIndex,
        schedules,
      },
    })),
    fetchLiveStreams: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: liveStreamItems,
      },
    })),
    addProgramReserve: vi.fn(async () => ({ ok: true as const, value: { reserveId: 1 } })),
    deleteReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockSkipReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockOverlapReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

export function createLiveNavigationConfig() {
  return {
    status: 'loaded' as const,
    liveStreamEnabled: true,
    enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'] as const,
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
    },
    urlscheme: {
      m2ts: {
        mac: 'vlc://PROTOCOL://ADDRESS',
      },
    },
  }
}

export async function chooseMuiSelectOption(name: string, optionName: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

export function renderOnAir({
  repository = createOnAirRepository([createSchedule('GR', 10, 30)]),
  settings = new DefaultSettingsFactory().create(),
  realtimeConnection,
  enabledBroadcastWaves = ['GR', 'BS', 'CS', 'SKY'] as const,
  initialHash = '/#/onair?type=BS',
}: {
  repository?: OnAirApiRepository
  settings?: ReturnType<DefaultSettingsFactory['create']>
  realtimeConnection?: SyntheticRealtimeConnection
  enabledBroadcastWaves?: readonly ('GR' | 'BS' | 'CS' | 'SKY')[]
  initialHash?: string
} = {}) {
  window.history.replaceState(null, '', initialHash)

  return render(
    <App
      settings={settings}
      apiRepository={createShellRepository()}
      onAirApiRepository={repository}
      realtimeConnectionFactory={
        realtimeConnection === undefined ? undefined : () => realtimeConnection
      }
      navigationConfig={{
        ...createLiveNavigationConfig(),
        enabledBroadcastWaves,
      }}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

export async function navigateHashRoute(hash: string): Promise<void> {
  await act(async () => {
    window.history.pushState(null, '', `/${hash}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
