import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { type ScrollHistoryState } from '@/app/scrollHistory'
import type { GuideApiRepository } from '@/features/guide/guideApi'

export class SyntheticRealtimeConnection {
  private readonly listeners = new Map<string, Set<() => void>>()

  on(eventName: string, listener: () => void): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<() => void>()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }
}

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
        liveStreamEnabled: false,
        enabledBroadcastWaves: ['GR', 'BS'] as const,
        encodeModes: ['H.264'],
      },
    })),
  }
}

export function createLiveNavigationConfig() {
  return {
    status: 'loaded' as const,
    liveStreamEnabled: true,
    enabledBroadcastWaves: ['GR', 'BS'] as const,
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
  }
}

export function createGuideNavigationConfigWithEncodeModes() {
  return {
    status: 'loaded' as const,
    liveStreamEnabled: false,
    enabledBroadcastWaves: ['GR', 'BS'] as const,
    encodeModes: ['H.264'],
  }
}

export async function chooseMuiSelectOption(
  name: string,
  optionName: string,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  fireEvent.mouseDown(root.getByRole('combobox', { name }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

export function expectMuiSelectText(
  name: string,
  text: string,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  expect(root.getByRole('combobox', { name })).toHaveTextContent(text)
}

export function expectMuiSelectBlank(
  name: string,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  expect(root.getByRole('combobox', { name })).toHaveTextContent('\u200b')
}

export function createGuideRepository(): GuideApiRepository {
  return {
    fetchSchedule: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
          },
          programs: [],
        },
      ],
    })),
    fetchReserveIndex: vi.fn(async () => ({
      ok: true as const,
      value: {},
    })),
    triggerReserveUpdate: vi.fn(async () => ({
      ok: true as const,
      value: {},
    })),
    addProgramReserve: vi.fn(async () => ({
      ok: true as const,
      value: {
        reserveId: 900,
      },
    })),
    deleteReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    unlockSkipReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    unlockOverlapReserve: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
  }
}

export function createRouteAwareScrollHistorySpy(): ScrollHistoryState & {
  savedDataByUrl: Array<{ url: string; data: unknown }>
} {
  let currentUrl = window.location.href
  const savedDataByUrl: Array<{ url: string; data: unknown }> = []

  return {
    savedDataByUrl,
    isNeedRestoreHistory: () => false,
    saveScrollData(data, url) {
      savedDataByUrl.push({ url: url ?? currentUrl, data })
    },
    getScrollData: () => null,
    getHistoryPosition: () => null,
    updateHistoryPosition(_position, url) {
      currentUrl = url ?? window.location.href
    },
    emitDoneGetData() {
      return undefined
    },
    async onDoneGetData() {
      return undefined
    },
    clearRestoreHistory() {
      return undefined
    },
  }
}

export async function waitForGuideVisible(): Promise<HTMLElement> {
  await screen.findByTestId('guide-page')
  await waitFor(() => {
    expect(screen.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  })

  return screen.getByTestId('guide-page')
}

export async function navigateHashRoute(hash: string): Promise<void> {
  await act(async () => {
    window.history.pushState(null, '', `/${hash}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}
