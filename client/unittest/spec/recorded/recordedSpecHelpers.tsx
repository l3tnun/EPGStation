import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { ServerConfigNavigationState } from '@/app/serverApi'

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

export function selectNameMatcher(name: string | RegExp): string | RegExp {
  if (name instanceof RegExp) {
    return name
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`^${escaped}(?:\\s+${escaped})?$`)
}

// MUI's Menu (backing the Select) keeps the listbox mounted until its close transition's
// `setTimeout`-driven `onExited` callback fires, which under real timers costs tens to a few
// hundred ms of actual wall-clock time per call, depending on the closing list's height. Every
// current caller of `changeSettingsSelect` invokes it before switching to fake timers (if it uses
// them at all), so it is safe to drive that transition deterministically here: temporarily fake
// `setTimeout`/`clearTimeout`, advance in small steps only until the listbox is actually gone
// (rather than jumping by a large fixed amount, which could also fire unrelated timers the
// surrounding page has scheduled), then restore whatever timer mode the caller had. If a future
// caller ever invokes this while already under fake timers, this leaves that mode alone and falls
// back to the real-time wait below (the caller then owns advancing its own timers).
async function closeSelectMenuTransition() {
  const wasAlreadyFake = vi.isFakeTimers()
  if (!wasAlreadyFake) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      for (
        let advancedMs = 0;
        advancedMs < 1000 && screen.queryByRole('listbox') !== null;
        advancedMs += 50
      ) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })
      }
    } finally {
      vi.useRealTimers()
    }
  }

  await waitFor(() => {
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
}

export async function changeSettingsSelect(
  name: string | RegExp,
  optionName: string | RegExp,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  fireEvent.mouseDown(await root.findByRole('combobox', { name: selectNameMatcher(name) }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
  await closeSelectMenuTransition()
}

export function expectMuiSelectText(
  name: string | RegExp,
  text: string,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  expect(root.getByRole('combobox', { name: selectNameMatcher(name) })).toHaveTextContent(text)
}

export async function expectMuiSelectOption(name: string | RegExp, optionName: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name: selectNameMatcher(name) }))
  expect(await screen.findByRole('option', { name: optionName })).toBeVisible()
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
}

export function expectMuiSelectBlank(
  name: string | RegExp,
  root: typeof screen | ReturnType<typeof within> = screen,
) {
  expect(root.getByRole('combobox', { name: selectNameMatcher(name) })).toHaveTextContent('\u200b')
}

export function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
}

export function createShellRepository(version = '9.9.9') {
  return {
    fetchVersion: vi.fn(async () => ({
      ok: true as const,
      value: {
        version,
      },
    })),
    fetchServerConfig: vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'loaded' as const,
        liveStreamEnabled: false,
        enabledBroadcastWaves: [] as const,
      },
    })),
  }
}

export function createPlaybackNavigationConfig(): ServerConfigNavigationState {
  return {
    status: 'loaded',
    liveStreamEnabled: false,
    enabledBroadcastWaves: [],
    streamConfig: {
      recorded: {
        ts: {
          webm: ['ts-webm'],
          hls: ['ts-hls'],
        },
        encoded: {
          webm: ['encoded-webm'],
          mp4: ['encoded-mp4'],
          hls: ['encoded-hls'],
        },
      },
    },
  }
}

export function defineNavigatorPlatformForTest({
  userAgent,
  platform,
  maxTouchPoints,
}: {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}): () => void {
  const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
  const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
  const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    'maxTouchPoints',
  )

  if (userAgent !== undefined) {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: userAgent,
    })
  }
  if (platform !== undefined) {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: platform,
    })
  }
  if (maxTouchPoints !== undefined) {
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: maxTouchPoints,
    })
  }

  return () => {
    if (userAgentDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'userAgent', userAgentDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'userAgent')
    }
    if (platformDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'platform', platformDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'platform')
    }
    if (maxTouchPointsDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'maxTouchPoints', maxTouchPointsDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'maxTouchPoints')
    }
  }
}

export function defineCoarsePointerForTest(matches: boolean): () => void {
  const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  return () => {
    if (matchMediaDescriptor !== undefined) {
      Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
    } else {
      Reflect.deleteProperty(window, 'matchMedia')
    }
  }
}
