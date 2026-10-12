import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import type { SearchRuleApiRepository } from '@/features/search/rule/api'

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
      value: { version: '9.9.9' },
    })),
    fetchServerConfig: vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'loaded' as const,
        liveStreamEnabled: false,
        enabledBroadcastWaves: ['GR', 'BS', 'CS'] as const,
        encodeModes: ['Synthetic Encode', 'Encode 2', 'Encode 3'],
        recordedDirectories: ['Synthetic Rule', 'Archive'],
      },
    })),
  }
}

// MUI's Menu (backing the Select) keeps the listbox mounted until its close transition's
// `setTimeout`-driven `onExited` callback fires, which under real timers costs tens to a few
// hundred ms of actual wall-clock time per call. Every current caller drives this before
// switching to fake timers of its own (if it uses them at all), so it is safe to fake
// `setTimeout`/`clearTimeout` here, advance in small steps only until the target is actually
// gone (rather than a large fixed jump, which could also fire unrelated timers the surrounding
// page has scheduled), then restore whatever timer mode the caller had. If a future caller ever
// invokes this while already under fake timers, this leaves that mode alone and falls back to
// the real-time wait below (the caller then owns advancing its own timers). Matches the
// `closeSelectMenuTransition` helper in `recorded/recordedSpecHelpers.tsx`.
async function waitForTransitionExit(queryGone: () => unknown) {
  const wasAlreadyFake = vi.isFakeTimers()
  if (!wasAlreadyFake) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      for (let advancedMs = 0; advancedMs < 1000 && queryGone() !== null; advancedMs += 50) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50)
        })
      }
    } finally {
      vi.useRealTimers()
    }
  }

  await waitFor(() => {
    expect(queryGone()).toBeNull()
  })
}

export async function chooseMuiSelectOption(name: string, optionName: string) {
  fireEvent.mouseDown(await screen.findByRole('combobox', { name }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
  if (screen.queryByRole('listbox') !== null) {
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitForTransitionExit(() => screen.queryByRole('listbox'))
  }
}

export async function closeSelectMenu() {
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  await waitForTransitionExit(() => screen.queryByRole('listbox'))
}

export async function closeSearchPeriodDialog(label: '開始' | '終了') {
  await waitForTransitionExit(() => screen.queryByRole('dialog', { name: `期間 ${label}` }))
}

export function expectMuiSelectText(name: string, text: string) {
  expect(screen.getByRole('combobox', { name })).toHaveTextContent(text)
}

export function expectMuiSelectBlank(name: string) {
  expect(screen.getByRole('combobox', { name })).toHaveTextContent('\u200b')
}

export async function expectMuiSelectOption(name: string, optionName: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  expect(await screen.findByRole('option', { name: optionName })).toBeVisible()
  await closeSelectMenu()
}

// `requestAnimationFrame` runs on jsdom's real polyfilled clock, so waiting for a fixed number of
// frames to elapse (rather than any specific outcome) costs real wall-clock time whose
// actual duration depends on how fast the host schedules each frame callback -- tens of ms per
// frame unloaded, but stretched further under CPU contention. Since callers only need "N frames
// have elapsed" and never a specific real duration, faking `requestAnimationFrame` and driving it
// with `advanceTimersByTimeAsync` settles the same number of frames without depending on how fast
// real frames would fire. Leaves fake timers alone if the caller already enabled them (mirrors
// `waitForTransitionExit` above).
export async function advanceAnimationFrames(frameCount: number) {
  const wasAlreadyFake = vi.isFakeTimers()
  if (!wasAlreadyFake) {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  }
  try {
    for (let index = 0; index < frameCount; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16)
      })
    }
  } finally {
    if (!wasAlreadyFake) {
      vi.useRealTimers()
    }
  }
}

export async function expectSearchScheduleCallsStable(
  searchRuleRepository: SearchRuleApiRepository,
  expectedCount: number,
) {
  for (let index = 0; index < 8; index += 1) {
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(expectedCount)
    })
    await advanceAnimationFrames(1)
  }
}

export function createSearchRuleRepository(): SearchRuleApiRepository {
  return {
    fetchSearchChannels: vi.fn(async () => ({
      ok: true as const,
      value: [
        { id: 12, name: 'Synthetic Channel' },
        { id: 33, name: 'Synthetic Rule Channel' },
      ],
    })),
    searchSchedules: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          id: 1001,
          name: 'Synthetic Program One',
          channelId: 12,
          channelName: 'Synthetic Channel',
          startAt: 1_700_000_000_000,
          endAt: 1_700_003_600_000,
          description: 'Synthetic description',
          isFree: true,
        },
      ],
    })),
    fetchReserveIndex: vi.fn(async () => ({
      ok: true as const,
      value: {},
    })),
    addProgramReserve: vi.fn(async () => ({
      ok: true as const,
      value: { reserveId: 501 },
    })),
    deleteReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockSkipReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unlockOverlapReserve: vi.fn(async () => ({ ok: true as const, value: undefined })),
    addRule: vi.fn(async () => ({ ok: true as const, value: { ruleId: 701 } })),
    updateRule: vi.fn(async () => ({ ok: true as const, value: undefined })),
    fetchRule: vi.fn(async (ruleId: number) => ({
      ok: true as const,
      value: {
        id: ruleId,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Synthetic',
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: null,
          recordedFormat: null,
        },
      },
    })),
    fetchRuleReserves: vi.fn(async () => ({
      ok: true as const,
      value: [],
    })),
    fetchRules: vi.fn(async () => ({
      ok: true as const,
      value: {
        rules: [
          {
            id: 901,
            searchOption: {
              keyword: 'Synthetic Rule Keyword',
              ignoreKeyword: 'Synthetic Ignore',
              channelIds: [101, 102],
              genres: [{ genre: 7, subGenre: 3 }],
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: true,
              allowEndLack: true,
              avoidDuplicate: false,
              periodToAvoidDuplicate: null,
            },
            reservesCnt: 4,
          },
          {
            id: 902,
            searchOption: {
              times: [{ week: 0x7f }],
            },
            reserveOption: {
              enable: false,
              allowEndLack: true,
              avoidDuplicate: false,
              periodToAvoidDuplicate: null,
            },
          },
        ],
        total: 2,
      },
    })),
    enableRule: vi.fn(async () => ({ ok: true as const, value: undefined })),
    disableRule: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteRule: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

// The very first render of `<App>` within a test file pays a one-time cost (React/MUI/theme
// first-use caches, JIT warm-up of the render path) that later renders in the same file do not
// pay again - a real, unmounted `<App>` render alone here takes noticeably longer as the first
// call in a file than as a later one (measured directly: ~2.1s cold vs. ~1.5s warm for an
// identical render+first-result wait). Left inside a test body, that cost competes with
// `findByRole`'s own 1000ms default poll window on whichever `it` happens to run first, and
// under `--coverage`'s heavier per-script instrumentation of a large, cold component tree,
// combined with CPU contention from other test files running in parallel, that window is
// sometimes missed (`TestingLibraryElementError: Unable to find role="button"...`) even though
// the same assertion is comfortably fast once the file is warm. Calling this once from
// `beforeAll` pays that one-time cost against the hook's own (separate, larger) timeout instead
// of a test's or a `findBy*` call's assertion budget, so every actual `it` in the file only ever
// renders `<App>` warm.
export async function warmUpSearchAppRender() {
  const previousHash = window.location.hash
  window.history.replaceState(null, '', '/#/search?keyword=Synthetic')

  const warmup = render(
    <App
      settings={new DefaultSettingsFactory().create()}
      apiRepository={createShellRepository()}
      searchRuleApiRepository={createSearchRuleRepository()}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )

  await screen.findByRole('button', { name: 'Synthetic Program One' }, { timeout: 8000 })
  warmup.unmount()
  window.history.replaceState(null, '', previousHash)
}
